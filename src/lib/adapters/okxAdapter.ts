import type {
  ExchangeAdapterTrade,
  ExchangeCredentials,
  AssetBalance,
  UnrealizedPosition,
} from '@/lib/types'
import { buildOkxSignedHeaders } from '@/lib/adapters/okxApi'
import type { ExchangeAdapter } from './exchangeFactory'
import {
  interpretOkxConfig,
  probeFailure,
  readJson,
  type CredentialProbeResult,
} from './credentialValidation'

import { OKX_BASE_URL as BASE_URL } from './exchangeBases'
const REQUEST_TIMEOUT = 10_000
const DEFAULT_LOOKBACK_MS = 365 * 24 * 60 * 60 * 1000
const OKX_HISTORY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000
const OKX_PAGE_LIMIT = 100

async function fetchWithTimeout(url: string, options?: RequestInit): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT)
  try {
    return await fetch(url, { ...options, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function fetchWithRetry(url: string, options?: RequestInit, attempt = 0): Promise<Response> {
  const response = await fetchWithTimeout(url, options)
  if (response.status === 429 && attempt < 4) {
    const backoff = Math.min(Math.pow(2, attempt) * 1000, 60_000)
    await sleep(backoff + Math.random() * 500)
    return fetchWithRetry(url, options, attempt + 1)
  }
  return response
}

export class OKXAdapter implements ExchangeAdapter {
  private futuresContractSpecsPromise: Promise<Map<string, OKXFuturesContractSpec>> | null = null

  private buildHeaders(
    credentials: ExchangeCredentials,
    method: string,
    pathWithQuery: string,
    body = ''
  ): Record<string, string> {
    return buildOkxSignedHeaders({
      apiKey: credentials.apiKey,
      apiSecret: credentials.apiSecret,
      passphrase: credentials.passphrase ?? '',
      method,
      requestPath: pathWithQuery,
      body,
    })
  }

  async validateCredentials(credentials: ExchangeCredentials): Promise<CredentialProbeResult> {
    try {
      if (!credentials.passphrase) return probeFailure('INVALID_SECRET_OR_PASSPHRASE')
      const path = '/api/v5/account/config'
      const headers = this.buildHeaders(credentials, 'GET', path)
      const response = await fetchWithRetry(`${BASE_URL}${path}`, { headers })
      return interpretOkxConfig(response.status, await readJson(response))
    } catch {
      return probeFailure('EXCHANGE_UNREACHABLE')
    }
  }

  async hasWithdrawPermission(credentials: ExchangeCredentials): Promise<boolean> {
    try {
      const path = '/api/v5/account/config'
      const headers = this.buildHeaders(credentials, 'GET', path)
      const response = await fetchWithRetry(`${BASE_URL}${path}`, { headers })
      if (!response.ok) return false
      const data = (await response.json()) as { code: string; data?: Array<{ perm?: string }> }
      if (data.code !== '0') return false
      const permissions = data.data?.map((item) => item.perm ?? '').join(',') ?? ''
      return permissions.toLowerCase().includes('withdraw')
    } catch {
      return false
    }
  }

  async fetchTrades(credentials: ExchangeCredentials, since?: Date): Promise<ExchangeAdapterTrade[]> {
    const startDate = since ?? new Date(Date.now() - DEFAULT_LOOKBACK_MS)
    const futuresContractSpecs = await this.getFuturesContractSpecs()

    const [fillTrades, fundingTrades] = await Promise.all([
      this.fetchTradeFills(credentials, startDate, futuresContractSpecs),
      this.fetchFundingBills(credentials, startDate),
    ])

    const merged = this.deduplicateTrades([...fillTrades, ...fundingTrades])
    if (merged.length > 0) {
      return merged
    }

    return this.fetchBillsArchiveFallback(credentials, startDate, futuresContractSpecs)
  }

  private async fetchTradeFills(
    credentials: ExchangeCredentials,
    since: Date,
    futuresContractSpecs: Map<string, OKXFuturesContractSpec>
  ): Promise<ExchangeAdapterTrade[]> {
    const startTime = since.getTime()
    const now = Date.now()
    const instTypes: Array<'SPOT' | 'SWAP' | 'FUTURES'> = ['SPOT', 'SWAP', 'FUTURES']
    const rows: ExchangeAdapterTrade[] = []

    for (const instType of instTypes) {
      let windowStart = startTime

      while (windowStart <= now) {
        let cursorEnd = Math.min(windowStart + OKX_HISTORY_WINDOW_MS - 1, now)

        for (let page = 0; page < 50; page += 1) {
          const query = new URLSearchParams({
            instType,
            begin: String(windowStart),
            end: String(cursorEnd),
            limit: String(OKX_PAGE_LIMIT),
          })

          const path = `/api/v5/trade/fills-history?${query.toString()}`
          const headers = this.buildHeaders(credentials, 'GET', path)
          const response = await fetchWithRetry(`${BASE_URL}${path}`, { headers })

          if (!response.ok) break

          const payload = (await response.json()) as { code: string; data?: OKXFill[] }
          if (payload.code !== '0') break

          const list = Array.isArray(payload.data) ? payload.data : []
          if (list.length === 0) break

          let oldestTs = cursorEnd
          for (const item of list) {
            const normalized = this.normalizeFill(item, futuresContractSpecs)
            rows.push(normalized)

            const itemTs = Number.parseInt(String(item.ts ?? ''), 10)
            if (Number.isFinite(itemTs)) {
              oldestTs = Math.min(oldestTs, itemTs)
            }
          }

          if (list.length < OKX_PAGE_LIMIT || oldestTs <= windowStart) {
            break
          }

          cursorEnd = oldestTs - 1
          await sleep(80)
        }

        windowStart = Math.min(windowStart + OKX_HISTORY_WINDOW_MS, now + 1)
        await sleep(80)
      }

      await sleep(80)
    }

    return this.deduplicateTrades(rows)
  }

  private async fetchFundingBills(
    credentials: ExchangeCredentials,
    since: Date
  ): Promise<ExchangeAdapterTrade[]> {
    const startTime = since.getTime()
    const now = Date.now()
    const rows: ExchangeAdapterTrade[] = []
    let windowStart = startTime

    while (windowStart <= now) {
      let cursorEnd = Math.min(windowStart + OKX_HISTORY_WINDOW_MS - 1, now)

      for (let page = 0; page < 50; page += 1) {
        const query = new URLSearchParams({
          type: '8',
          begin: String(windowStart),
          end: String(cursorEnd),
          limit: String(OKX_PAGE_LIMIT),
        })

        const path = `/api/v5/account/bills-archive?${query.toString()}`
        const headers = this.buildHeaders(credentials, 'GET', path)
        const response = await fetchWithRetry(`${BASE_URL}${path}`, { headers })

        if (!response.ok) break

        const payload = (await response.json()) as { code: string; data?: OKXBill[] }
        if (payload.code !== '0') break

        const list = Array.isArray(payload.data) ? payload.data : []
        if (list.length === 0) break

        let oldestTs = cursorEnd
        for (const item of list) {
          rows.push(this.normalizeFundingBill(item))

          const itemTs = Number.parseInt(String(item.ts ?? ''), 10)
          if (Number.isFinite(itemTs)) {
            oldestTs = Math.min(oldestTs, itemTs)
          }
        }

        if (list.length < OKX_PAGE_LIMIT || oldestTs <= windowStart) {
          break
        }

        cursorEnd = oldestTs - 1
        await sleep(80)
      }

      windowStart = Math.min(windowStart + OKX_HISTORY_WINDOW_MS, now + 1)
      await sleep(80)
    }

    return this.deduplicateTrades(rows)
  }

  private async fetchBillsArchiveFallback(
    credentials: ExchangeCredentials,
    since: Date,
    futuresContractSpecs: Map<string, OKXFuturesContractSpec>
  ): Promise<ExchangeAdapterTrade[]> {
    const startTime = since.getTime()
    const now = Date.now()
    const rows: ExchangeAdapterTrade[] = []
    let windowStart = startTime

    while (windowStart <= now) {
      let cursorEnd = Math.min(windowStart + OKX_HISTORY_WINDOW_MS - 1, now)

      for (let page = 0; page < 50; page += 1) {
        const query = new URLSearchParams({
          begin: String(windowStart),
          end: String(cursorEnd),
          limit: String(OKX_PAGE_LIMIT),
        })

        const path = `/api/v5/account/bills-archive?${query.toString()}`
        const headers = this.buildHeaders(credentials, 'GET', path)
        const response = await fetchWithRetry(`${BASE_URL}${path}`, { headers })

        if (!response.ok) break

        const payload = (await response.json()) as { code: string; data?: OKXBill[] }
        if (payload.code !== '0') break

        const list = Array.isArray(payload.data) ? payload.data : []
        if (list.length === 0) break

        let oldestTs = cursorEnd
        for (const item of list) {
          if (!['2', '8', '14'].includes(String(item.type ?? ''))) continue
          rows.push(this.normalizeBill(item, futuresContractSpecs))

          const itemTs = Number.parseInt(String(item.ts ?? ''), 10)
          if (Number.isFinite(itemTs)) {
            oldestTs = Math.min(oldestTs, itemTs)
          }
        }

        if (list.length < OKX_PAGE_LIMIT || oldestTs <= windowStart) {
          break
        }

        cursorEnd = oldestTs - 1
        await sleep(80)
      }

      windowStart = Math.min(windowStart + OKX_HISTORY_WINDOW_MS, now + 1)
      await sleep(80)
    }

    return this.deduplicateTrades(rows)
  }

  async fetchOpenPositions(credentials: ExchangeCredentials): Promise<UnrealizedPosition[]> {
    const path = '/api/v5/account/positions'
    const headers = this.buildHeaders(credentials, 'GET', path)
    const response = await fetchWithRetry(`${BASE_URL}${path}`, { headers })

    if (!response.ok) return []

    const data = (await response.json()) as { code: string; data: OKXPosition[] }
    if (data.code !== '0') return []

    return data.data
      .filter((position) => Math.abs(parseFloat(position.pos ?? '0')) > 0)
      .map((position) => ({
        symbol: (position.instId ?? '').replace(/-/g, ''),
        side: (position.posSide ?? '').toLowerCase() === 'short' ? 'short' : 'long',
        size: Math.abs(parseFloat(position.pos ?? '0')),
        entryPrice: parseFloat(position.avgPx ?? '0'),
        markPrice: parseFloat(position.markPx ?? '0'),
        unrealizedPnl: parseFloat(position.upl ?? '0'),
        leverage: parseFloat(position.lever ?? '0') || 1,
        tradeType: 'futures',
      }))
  }

  async fetchBalances(credentials: ExchangeCredentials): Promise<AssetBalance[]> {
    const path = '/api/v5/account/balance'
    const headers = this.buildHeaders(credentials, 'GET', path)
    const response = await fetchWithRetry(`${BASE_URL}${path}`, { headers })

    if (!response.ok) return []

    const data = (await response.json()) as {
      code: string
      data: Array<{ details: Array<{ ccy: string; cashBal: string; frozenBal: string }> }>
    }
    if (data.code !== '0') return []

    const result: AssetBalance[] = []
    for (const account of data.data) {
      for (const detail of account.details) {
        const free = parseFloat(detail.cashBal)
        const locked = parseFloat(detail.frozenBal)
        const total = free + locked
        if (total <= 0) continue
        const usdPrice = await this.getUsdPrice(detail.ccy)
        result.push({
          asset: detail.ccy,
          free,
          locked,
          usdValue: total * usdPrice,
        })
      }
    }

    return result
  }

  private normalizeBill(
    bill: OKXBill,
    futuresContractSpecs: Map<string, OKXFuturesContractSpec>
  ): ExchangeAdapterTrade {
    const pnl = parseFloat(bill.pnl ?? '0')
    const fee = parseFloat(bill.fee ?? '0')
    const amount = pnl + fee
    const side: 'buy' | 'sell' = amount >= 0 ? 'sell' : 'buy'
    const rawQuantity = parseFloat(bill.sz ?? '0')
    const rawPrice = parseFloat(bill.px ?? '0')
    const quantity = this.normalizeFuturesQuantity(
      bill.instType,
      bill.instId,
      rawQuantity,
      rawPrice,
      futuresContractSpecs
    )

    return {
      external_trade_id: `okx_bill_${bill.billId}`,
      symbol: (bill.instId ?? '').replace(/-/g, ''),
      side,
      quantity,
      price: Number.isFinite(rawPrice) ? rawPrice : 0,
      fee: Math.abs(fee),
      fee_currency: bill.ccy ?? 'USDT',
      realized_pnl: amount,
      funding_fee: bill.type === '8' ? fee : 0,
      income_type: bill.type,
      trade_type: bill.instType === 'SPOT' ? 'spot' : 'futures',
      traded_at: new Date(parseInt(bill.ts, 10)).toISOString(),
      raw_data: bill as unknown as Record<string, unknown>,
    }
  }

  private normalizeFill(
    fill: OKXFill,
    futuresContractSpecs: Map<string, OKXFuturesContractSpec>
  ): ExchangeAdapterTrade {
    const symbol = (fill.instId ?? '').replace(/-/g, '')
    const side: 'buy' | 'sell' = (fill.side ?? '').toLowerCase() === 'sell' ? 'sell' : 'buy'
    const instType = String(fill.instType ?? '').toUpperCase()

    const rawQuantity = parseFloat(fill.fillSz ?? '0')
    const rawPrice = parseFloat(fill.fillPx ?? '0')
    const rawFee = parseFloat(fill.fillFee ?? '0')
    const rawPnl = parseFloat(fill.fillPnl ?? '')
    const parsedTs = Number.parseInt(String(fill.ts ?? ''), 10)

    const price = Number.isFinite(rawPrice) ? rawPrice : 0
    const quantity = this.normalizeFuturesQuantity(
      instType,
      fill.instId,
      rawQuantity,
      price,
      futuresContractSpecs
    )
    const fee = Number.isFinite(rawFee) ? Math.abs(rawFee) : 0
    const realizedPnl = Number.isFinite(rawPnl) ? rawPnl : null
    const tradedAt = Number.isFinite(parsedTs)
      ? new Date(parsedTs).toISOString()
      : new Date().toISOString()

    const tradeType = instType === 'SPOT' ? 'spot' : 'futures'
    const tradeId = String(fill.tradeId ?? fill.ordId ?? `${symbol}:${tradedAt}`).trim()

    return {
      external_trade_id: `okx_fill_${tradeId}`,
      symbol,
      side,
      quantity,
      price,
      fee,
      fee_currency: fill.fillFeeCcy ?? 'USDT',
      realized_pnl: realizedPnl,
      funding_fee: 0,
      income_type: fill.execType ?? null,
      trade_type: tradeType,
      traded_at: tradedAt,
      raw_data: fill as unknown as Record<string, unknown>,
    }
  }

  private async getFuturesContractSpecs(): Promise<Map<string, OKXFuturesContractSpec>> {
    if (!this.futuresContractSpecsPromise) {
      this.futuresContractSpecsPromise = this.fetchFuturesContractSpecs()
    }

    return this.futuresContractSpecsPromise
  }

  private async fetchFuturesContractSpecs(): Promise<Map<string, OKXFuturesContractSpec>> {
    const specs = new Map<string, OKXFuturesContractSpec>()
    const instTypes: Array<'SWAP' | 'FUTURES'> = ['SWAP', 'FUTURES']

    for (const instType of instTypes) {
      const query = new URLSearchParams({ instType })
      const path = `/api/v5/public/instruments?${query.toString()}`
      const response = await fetchWithRetry(`${BASE_URL}${path}`)
      if (!response.ok) {
        continue
      }

      const payload = (await response.json()) as {
        code: string
        data?: OKXPublicInstrument[]
      }

      if (payload.code !== '0' || !Array.isArray(payload.data)) {
        continue
      }

      for (const instrument of payload.data) {
        const instId = String(instrument.instId ?? '').toUpperCase()
        if (!instId) {
          continue
        }

        const ctVal = Number.parseFloat(String(instrument.ctVal ?? ''))
        if (!Number.isFinite(ctVal) || ctVal <= 0) {
          continue
        }

        const [baseCcyRaw, quoteCcyRaw] = instId.split('-')
        const baseCcy = String(baseCcyRaw ?? '').toUpperCase()
        const quoteCcy = String(quoteCcyRaw ?? '').toUpperCase()
        const ctValCcyRaw = String(instrument.ctValCcy ?? '').toUpperCase()

        specs.set(instId, {
          ctVal,
          ctValCcy: ctValCcyRaw || null,
          baseCcy,
          quoteCcy,
        })
      }
    }

    return specs
  }

  private normalizeFuturesQuantity(
    instType: string,
    instId: string | undefined,
    rawQuantity: number,
    price: number,
    futuresContractSpecs: Map<string, OKXFuturesContractSpec>
  ): number {
    const quantity = Number.isFinite(rawQuantity) ? Math.abs(rawQuantity) : 0
    if (quantity === 0) {
      return 0
    }

    const upperInstType = instType.toUpperCase()
    if (upperInstType !== 'SWAP' && upperInstType !== 'FUTURES') {
      return quantity
    }

    const instKey = String(instId ?? '').toUpperCase()
    if (!instKey) {
      return quantity
    }

    const contract = futuresContractSpecs.get(instKey)
    if (!contract || contract.ctVal <= 0) {
      return quantity
    }

    if (contract.ctValCcy && contract.baseCcy && contract.ctValCcy === contract.baseCcy) {
      return quantity * contract.ctVal
    }

    if (
      contract.ctValCcy &&
      contract.quoteCcy &&
      contract.ctValCcy === contract.quoteCcy &&
      Number.isFinite(price) &&
      price > 0
    ) {
      return (quantity * contract.ctVal) / price
    }

    return quantity
  }

  private normalizeFundingBill(bill: OKXBill): ExchangeAdapterTrade {
    const pnl = parseFloat(bill.pnl ?? '0')
    const fee = parseFloat(bill.fee ?? '0')
    const amount =
      (Number.isFinite(pnl) ? pnl : 0) +
      (Number.isFinite(fee) ? fee : 0)
    const side: 'buy' | 'sell' = amount >= 0 ? 'sell' : 'buy'
    const parsedTs = Number.parseInt(String(bill.ts ?? ''), 10)

    return {
      external_trade_id: `okx_funding_${bill.billId}`,
      symbol: (bill.instId ?? '').replace(/-/g, ''),
      side,
      quantity: 0,
      price: 0,
      fee: 0,
      fee_currency: bill.ccy ?? 'USDT',
      realized_pnl: amount,
      funding_fee: amount,
      income_type: 'funding_fee',
      trade_type: bill.instType === 'SPOT' ? 'spot' : 'futures',
      traded_at: Number.isFinite(parsedTs)
        ? new Date(parsedTs).toISOString()
        : new Date().toISOString(),
      raw_data: bill as unknown as Record<string, unknown>,
    }
  }

  private deduplicateTrades(trades: ExchangeAdapterTrade[]): ExchangeAdapterTrade[] {
    const dedup = new Set<string>()

    return trades.filter((trade) => {
      const key = `${trade.symbol}:${trade.external_trade_id}`
      if (dedup.has(key)) return false
      dedup.add(key)
      return true
    })
  }

  private async getUsdPrice(asset: string): Promise<number> {
    if (asset === 'USDT' || asset === 'USDC' || asset === 'BUSD' || asset === 'USD') return 1
    try {
      const path = `/api/v5/market/ticker?instId=${asset}-USDT`
      const response = await fetchWithRetry(`${BASE_URL}${path}`)
      if (!response.ok) return 0
      const data = (await response.json()) as { code: string; data?: Array<{ last: string }> }
      if (data.code !== '0') return 0
      return data.data?.[0]?.last ? parseFloat(data.data[0].last) : 0
    } catch {
      return 0
    }
  }
}

type OKXBill = {
  billId: string
  type: string
  instType: string
  instId: string
  ccy: string
  pnl: string
  fee: string
  sz: string
  px: string
  ts: string
}

type OKXFill = {
  tradeId?: string
  ordId?: string
  instType?: string
  instId?: string
  side?: string
  fillSz?: string
  fillPx?: string
  fillFee?: string
  fillFeeCcy?: string
  fillPnl?: string
  execType?: string
  ts?: string
}

type OKXPosition = {
  instId: string
  posSide: string
  pos: string
  avgPx: string
  markPx: string
  upl: string
  lever: string
}

type OKXPublicInstrument = {
  instId?: string
  ctVal?: string
  ctValCcy?: string
}

type OKXFuturesContractSpec = {
  ctVal: number
  ctValCcy: string | null
  baseCcy: string
  quoteCcy: string
}
