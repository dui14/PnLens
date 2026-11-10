import { createHash, createHmac } from 'crypto'
import type {
  ExchangeAdapterTrade,
  ExchangeCredentials,
  AssetBalance,
  UnrealizedPosition,
} from '@/lib/types'
import type { ExchangeAdapter } from './exchangeFactory'
import {
  interpretGateAccountDetail,
  probeFailure,
  readJson,
  type CredentialProbeResult,
} from './credentialValidation'

import { GATEIO_BASE_URL as BASE_URL } from './exchangeBases'
import { fetchExchange } from './httpClient'
import { throwOnServerPage } from './exchangeWindowError'
import {
  TradeRejectCounter,
  decimalOrZero,
  flexibleTimeToIso,
  optionalDecimal,
  requiredDecimal,
  type TradeRejectCounts,
} from './tradeFields'
const REQUEST_TIMEOUT = 10_000
const DEFAULT_LOOKBACK_MS = 365 * 24 * 60 * 60 * 1000
const GATE_MAX_WINDOW_SECONDS = 30 * 24 * 60 * 60

type GateHttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

function toHexSha512(payload: string): string {
  return createHash('sha512').update(payload).digest('hex')
}

function signGateio(
  secret: string,
  method: GateHttpMethod,
  requestPath: string,
  queryString: string,
  body: string,
  timestamp: string
): string {
  const payloadHash = toHexSha512(body)
  const signPayload = `${method}\n/api/v4${requestPath}\n${queryString}\n${payloadHash}\n${timestamp}`
  return createHmac('sha512', secret).update(signPayload).digest('hex')
}

function asNumber(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value ?? 0)
  return Number.isFinite(parsed) ? parsed : 0
}

function normalizeSymbol(raw: string | undefined): string {
  if (!raw) return ''
  return raw.replace(/[^A-Z0-9]/gi, '').toUpperCase()
}

function toIsoFromGateTimestamp(value: unknown): string | null {
  return flexibleTimeToIso(value)
}

async function fetchWithTimeout(url: string, options?: RequestInit): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT)
  try {
    return await fetchExchange(url, { ...options, signal: controller.signal })
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

export class GateioAdapter implements ExchangeAdapter {
  private futuresContractSpecsBySettle = new Map<string, Map<string, GateFuturesContractSpec>>()
  private readonly rejections = new TradeRejectCounter()

  rejectedTradeCounts(): TradeRejectCounts {
    return this.rejections.counts
  }

  private buildHeaders(
    credentials: ExchangeCredentials,
    method: GateHttpMethod,
    requestPath: string,
    queryString = '',
    body = ''
  ): Record<string, string> {
    const timestamp = Math.floor(Date.now() / 1000).toString()
    const signature = signGateio(
      credentials.apiSecret,
      method,
      requestPath,
      queryString,
      body,
      timestamp
    )

    return {
      KEY: credentials.apiKey,
      Timestamp: timestamp,
      SIGN: signature,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    }
  }

  async validateCredentials(credentials: ExchangeCredentials): Promise<CredentialProbeResult> {
    try {
      const requestPath = '/account/detail'
      const headers = this.buildHeaders(credentials, 'GET', requestPath)
      const response = await fetchWithRetry(`${BASE_URL}${requestPath}`, {
        method: 'GET',
        headers,
      })
      return interpretGateAccountDetail(response.status, await readJson(response))
    } catch {
      return probeFailure('EXCHANGE_UNREACHABLE')
    }
  }

  async hasWithdrawPermission(credentials: ExchangeCredentials): Promise<boolean> {
    void credentials
    return false
  }

  private scanEndMs = 0

  async fetchTrades(credentials: ExchangeCredentials, since?: Date, until?: Date): Promise<ExchangeAdapterTrade[]> {
    this.scanEndMs = until?.getTime() ?? Date.now()
    this.rejections.reset()
    const startMs = since ? since.getTime() : Date.now() - DEFAULT_LOOKBACK_MS

    const [spotTrades, futuresTrades, positionCloseEvents] = await Promise.all([
      this.fetchSpotTrades(credentials, startMs),
      this.fetchFuturesTrades(credentials, startMs),
      this.fetchPositionCloseEvents(credentials, startMs),
    ])

    return this.deduplicateTrades([...spotTrades, ...futuresTrades, ...positionCloseEvents])
  }

  async fetchOpenPositions(credentials: ExchangeCredentials): Promise<UnrealizedPosition[]> {
    const settles = ['usdt', 'btc']
    const positions: UnrealizedPosition[] = []

    for (const settle of settles) {
      const futuresContractSpecs = await this.getFuturesContractSpecs(settle)
      const requestPath = `/futures/${settle}/positions`
      const headers = this.buildHeaders(credentials, 'GET', requestPath)
      const response = await fetchWithRetry(`${BASE_URL}${requestPath}`, {
        method: 'GET',
        headers,
      })

      if (!response.ok) continue
      const data = (await response.json()) as unknown
      if (!Array.isArray(data)) continue

      for (const item of data) {
        if (!item || typeof item !== 'object') continue
        const row = item as GateFuturesPosition
        const sizeRaw = asNumber(row.size ?? row.position_size ?? 0)
        if (sizeRaw === 0) continue

        const symbol = normalizeSymbol(row.contract)
        if (!symbol) continue

        const entryPrice = asNumber(row.entry_price ?? row.avg_entry_price)
        const markPrice = asNumber(row.mark_price)
        const unrealizedPnl = asNumber(row.unrealised_pnl ?? row.unrealized_pnl)
        const leverage = asNumber(row.leverage) || 1

        positions.push({
          symbol,
          side: sizeRaw < 0 ? 'short' : 'long',
          size: this.normalizeFuturesQuantity(sizeRaw, row.contract, futuresContractSpecs),
          entryPrice,
          markPrice,
          unrealizedPnl,
          leverage,
          tradeType: 'futures',
        })
      }
    }

    return positions
  }

  async fetchBalances(credentials: ExchangeCredentials): Promise<AssetBalance[]> {
    const requestPath = '/spot/accounts'
    const headers = this.buildHeaders(credentials, 'GET', requestPath)
    const response = await fetchWithRetry(`${BASE_URL}${requestPath}`, {
      method: 'GET',
      headers,
    })

    if (!response.ok) return []
    const data = (await response.json()) as unknown
    if (!Array.isArray(data)) return []

    const balances: AssetBalance[] = []
    for (const item of data) {
      if (!item || typeof item !== 'object') continue
      const row = item as GateSpotAccount
      const asset = (row.currency ?? '').toUpperCase()
      if (!asset) continue

      const free = asNumber(row.available)
      const locked = asNumber(row.locked)
      const total = free + locked
      if (total <= 0) continue

      const usdPrice = await this.getUsdPrice(asset)
      balances.push({
        asset,
        free,
        locked,
        usdValue: total * usdPrice,
      })
    }

    return balances
  }

  private async fetchSpotTrades(
    credentials: ExchangeCredentials,
    startMs: number
  ): Promise<ExchangeAdapterTrade[]> {
    const allTrades: ExchangeAdapterTrade[] = []
    const nowSec = Math.floor(this.scanEndMs / 1000)
    let windowStartSec = Math.floor(startMs / 1000)

    while (windowStartSec <= nowSec) {
      const windowEndSec = Math.min(windowStartSec + GATE_MAX_WINDOW_SECONDS - 1, nowSec)

      for (let page = 1; page <= 100; page += 1) {
        const query = new URLSearchParams({
          from: String(windowStartSec),
          to: String(windowEndSec),
          limit: '1000',
          page: String(page),
        })
        const queryString = query.toString()
        const requestPath = '/spot/my_trades'
        const headers = this.buildHeaders(credentials, 'GET', requestPath, queryString)
        const response = await fetchWithRetry(`${BASE_URL}${requestPath}?${queryString}`, {
          method: 'GET',
          headers,
        })

        throwOnServerPage(response)
          if (!response.ok) break
        const data = (await response.json()) as unknown
        if (!Array.isArray(data)) break
        const pageTrades = data as GateSpotTrade[]
        if (pageTrades.length === 0) break

        allTrades.push(...pageTrades.flatMap((trade) => this.accepted(this.normalizeSpotTrade(trade))))

        if (pageTrades.length < 1000) break
        await sleep(60)
      }

      windowStartSec = windowEndSec + 1
      await sleep(60)
    }

    return allTrades
  }

  private async fetchFuturesTrades(
    credentials: ExchangeCredentials,
    startMs: number
  ): Promise<ExchangeAdapterTrade[]> {
    const settles = ['usdt', 'btc']
    const allTrades: ExchangeAdapterTrade[] = []
    const nowSec = Math.floor(this.scanEndMs / 1000)
    const startSec = Math.floor(startMs / 1000)

    for (const settle of settles) {
      let windowStartSec = startSec
      while (windowStartSec <= nowSec) {
        const windowEndSec = Math.min(windowStartSec + GATE_MAX_WINDOW_SECONDS - 1, nowSec)

        for (let offset = 0; offset <= 10_000; offset += 100) {
          const query = new URLSearchParams({
            from: String(windowStartSec),
            to: String(windowEndSec),
            limit: '100',
            offset: String(offset),
          })
          const queryString = query.toString()
          const requestPath = `/futures/${settle}/my_trades_timerange`
          const headers = this.buildHeaders(credentials, 'GET', requestPath, queryString)
          const response = await fetchWithRetry(`${BASE_URL}${requestPath}?${queryString}`, {
            method: 'GET',
            headers,
          })

          throwOnServerPage(response)
          if (!response.ok) break
          const data = (await response.json()) as unknown
          if (!Array.isArray(data)) break
          const pageTrades = data as GateFuturesTrade[]
          if (pageTrades.length === 0) break

          allTrades.push(
            ...pageTrades.flatMap((trade) =>
              this.accepted(this.normalizeFuturesTrade(trade, settle))
            )
          )

          if (pageTrades.length < 100) break
          await sleep(60)
        }

        windowStartSec = windowEndSec + 1
        await sleep(60)
      }
    }

    return allTrades
  }

  private async fetchPositionCloseEvents(
    credentials: ExchangeCredentials,
    startMs: number
  ): Promise<ExchangeAdapterTrade[]> {
    const settles = ['usdt', 'btc']
    const events: ExchangeAdapterTrade[] = []
    const nowSec = Math.floor(this.scanEndMs / 1000)
    const startSec = Math.floor(startMs / 1000)

    for (const settle of settles) {
      let windowStartSec = startSec
      while (windowStartSec <= nowSec) {
        const windowEndSec = Math.min(windowStartSec + GATE_MAX_WINDOW_SECONDS - 1, nowSec)

        for (let offset = 0; offset <= 10_000; offset += 100) {
          const query = new URLSearchParams({
            from: String(windowStartSec),
            to: String(windowEndSec),
            limit: '100',
            offset: String(offset),
          })
          const queryString = query.toString()
          const requestPath = `/futures/${settle}/position_close`
          const headers = this.buildHeaders(credentials, 'GET', requestPath, queryString)
          const response = await fetchWithRetry(`${BASE_URL}${requestPath}?${queryString}`, {
            method: 'GET',
            headers,
          })

          throwOnServerPage(response)
          if (!response.ok) break
          const data = (await response.json()) as unknown
          if (!Array.isArray(data)) break
          const pageEvents = data as GatePositionClose[]
          if (pageEvents.length === 0) break

          for (const row of pageEvents) {
            const normalized = this.normalizePositionCloseEvent(row)
            if (normalized) {
              events.push(normalized)
            }
          }

          if (pageEvents.length < 100) break
          await sleep(60)
        }

        windowStartSec = windowEndSec + 1
        await sleep(60)
      }
    }

    return events
  }

  private accepted(trade: ExchangeAdapterTrade | null): ExchangeAdapterTrade[] {
    return trade ? [trade] : []
  }

  private stableTradeId(
    explicitId: unknown,
    prefix: 'spot' | 'futures',
    orderId: unknown,
    timeValue: unknown
  ): string | null {
    if (typeof explicitId === 'string' && explicitId.trim()) return explicitId.trim()
    if (typeof orderId === 'string' && orderId.trim() && (typeof timeValue === 'string' || typeof timeValue === 'number')) {
      return `${prefix}_${orderId.trim()}_${timeValue}`
    }
    return null
  }

  private normalizeSpotTrade(trade: GateSpotTrade): ExchangeAdapterTrade | null {
    const tradedAt = toIsoFromGateTimestamp(trade.create_time_ms ?? trade.create_time)
    if (!tradedAt) return this.rejections.reject('INVALID_TIMESTAMP')
    const externalTradeId = this.stableTradeId(
      trade.id,
      'spot',
      trade.order_id,
      trade.create_time_ms ?? trade.create_time
    )
    if (!externalTradeId) return this.rejections.reject('MISSING_ID')
    const quantity = requiredDecimal(
      typeof trade.amount === 'string' ? trade.amount : typeof trade.size === 'string' ? trade.size : null,
      this.rejections
    )
    if (!quantity) return null
    const price = requiredDecimal(typeof trade.price === 'string' ? trade.price : null, this.rejections)
    if (!price) return null
    const fee = decimalOrZero(typeof trade.fee === 'string' ? trade.fee : trade.fee === undefined ? undefined : null, this.rejections)
    if (!fee) return null
    const side = (trade.side ?? '').toLowerCase() === 'sell' ? 'sell' : 'buy'
    return {
      external_trade_id: externalTradeId,
      symbol: normalizeSymbol(trade.currency_pair),
      side,
      quantity,
      price,
      fee,
      fee_currency: (trade.fee_currency ?? 'USDT').toUpperCase(),
      realized_pnl: null,
      funding_fee: '0',
      income_type: null,
      trade_type: 'spot',
      traded_at: tradedAt,
      raw_data: trade as unknown as Record<string, unknown>,
    }
  }

  private normalizeFuturesTrade(trade: GateFuturesTrade, settle: string): ExchangeAdapterTrade | null {
    const tradedAt = toIsoFromGateTimestamp(trade.create_time_ms ?? trade.create_time)
    if (!tradedAt) return this.rejections.reject('INVALID_TIMESTAMP')
    const externalTradeId = this.stableTradeId(
      trade.id,
      'futures',
      trade.order_id,
      trade.create_time_ms ?? trade.create_time
    )
    if (!externalTradeId) return this.rejections.reject('MISSING_ID')
    const quantity = requiredDecimal(
      typeof trade.size === 'string' ? trade.size : typeof trade.qty === 'string' ? trade.qty : null,
      this.rejections
    )
    if (!quantity) return null
    const price = requiredDecimal(typeof trade.price === 'string' ? trade.price : null, this.rejections)
    if (!price) return null
    const fee = decimalOrZero(typeof trade.fee === 'string' ? trade.fee : undefined, this.rejections)
    if (!fee) return null
    const realizedPnl = optionalDecimal(typeof trade.pnl === 'string' ? trade.pnl : trade.pnl === undefined || trade.pnl === null ? null : undefined, this.rejections)
    if (realizedPnl === undefined) return null
    const sideField = typeof trade.side === 'string' ? trade.side.toLowerCase() : ''
    const sideFromSize: 'buy' | 'sell' = quantity.startsWith('-') && !/^-0(\.0+)?$/.test(quantity) ? 'sell' : 'buy'
    const side: 'buy' | 'sell' = sideField === 'sell' ? 'sell' : sideField === 'buy' ? 'buy' : sideFromSize
    return {
      external_trade_id: externalTradeId,
      symbol: normalizeSymbol(trade.contract),
      side,
      quantity,
      price,
      fee,
      fee_currency: (trade.fee_currency ?? settle ?? trade.settle ?? 'USDT').toUpperCase(),
      realized_pnl: realizedPnl,
      funding_fee: '0',
      income_type: 'fill_history',
      trade_type: 'futures',
      traded_at: tradedAt,
      raw_data: trade as unknown as Record<string, unknown>,
    }
  }

  private async getFuturesContractSpecs(
    settle: string
  ): Promise<Map<string, GateFuturesContractSpec>> {
    const settleKey = settle.toLowerCase()
    const cached = this.futuresContractSpecsBySettle.get(settleKey)
    if (cached) {
      return cached
    }

    const requestPath = `/futures/${settleKey}/contracts`
    const response = await fetchWithRetry(`${BASE_URL}${requestPath}`, {
      method: 'GET',
    })

    const specs = new Map<string, GateFuturesContractSpec>()
    if (!response.ok) {
      this.futuresContractSpecsBySettle.set(settleKey, specs)
      return specs
    }

    const data = (await response.json()) as unknown
    if (!Array.isArray(data)) {
      this.futuresContractSpecsBySettle.set(settleKey, specs)
      return specs
    }

    for (const item of data) {
      if (!item || typeof item !== 'object') continue
      const row = item as GateFuturesContract
      const contractName = String(row.name ?? '').toUpperCase()
      if (!contractName) continue

      const multiplierRaw = asNumber(row.quanto_multiplier ?? row.multiplier)
      const multiplier = Number.isFinite(multiplierRaw) ? Math.abs(multiplierRaw) : 0
      if (multiplier <= 0) continue

      specs.set(contractName, {
        multiplier,
      })
    }

    this.futuresContractSpecsBySettle.set(settleKey, specs)
    return specs
  }

  private normalizeFuturesQuantity(
    rawSize: number,
    contract: string | undefined,
    futuresContractSpecs: Map<string, GateFuturesContractSpec>
  ): number {
    const size = Number.isFinite(rawSize) ? Math.abs(rawSize) : 0
    if (size === 0) {
      return 0
    }

    const contractName = String(contract ?? '').toUpperCase()
    if (!contractName) {
      return size
    }

    const multiplier = futuresContractSpecs.get(contractName)?.multiplier ?? 0
    if (!(multiplier > 0)) {
      return size
    }

    return size * multiplier
  }

  private normalizePositionCloseEvent(trade: GatePositionClose): ExchangeAdapterTrade | null {
    const pnlSource = trade.pnl ?? trade.close_pnl ?? trade.realized_pnl
    const pnl = optionalDecimal(typeof pnlSource === 'string' ? pnlSource : null, this.rejections)
    if (pnl === undefined || pnl === null) return null

    const symbol = normalizeSymbol(trade.contract)
    if (!symbol) return null

    const sideField = typeof trade.side === 'string' ? trade.side.toLowerCase() : ''
    const sizeText = typeof trade.size === 'string' ? trade.size : ''
    const sideFromSize: 'buy' | 'sell' = sizeText.startsWith('-') && !/^-0(\.0+)?$/.test(sizeText) ? 'sell' : 'buy'
    const side: 'buy' | 'sell' = sideField === 'sell' ? 'sell' : sideField === 'buy' ? 'buy' : sideFromSize

    const eventTs = trade.close_time_ms ?? trade.time_ms ?? trade.close_time ?? trade.time
    const tradedAt = toIsoFromGateTimestamp(eventTs)
    if (!tradedAt) return this.rejections.reject('INVALID_TIMESTAMP')
    const externalTradeId =
      (typeof trade.id === 'string' && trade.id.trim()) ||
      (typeof trade.order_id === 'string' && trade.order_id.trim()
        ? `position_close_${trade.order_id.trim()}_${String(eventTs)}`
        : '')
    if (!externalTradeId) return this.rejections.reject('MISSING_ID')
    const fee = decimalOrZero(typeof trade.fee === 'string' ? trade.fee : undefined, this.rejections)
    if (!fee) return null
    const fundingFee = decimalOrZero(
      typeof trade.funding_fee === 'string' ? trade.funding_fee : undefined,
      this.rejections
    )
    if (!fundingFee) return null

    return {
      external_trade_id: externalTradeId,
      symbol,
      side,
      quantity: '0',
      price: '0',
      fee,
      fee_currency: (trade.fee_currency ?? trade.settle ?? 'USDT').toUpperCase(),
      realized_pnl: pnl,
      funding_fee: fundingFee,
      income_type: 'position_close',
      trade_type: 'futures',
      traded_at: tradedAt,
      raw_data: trade as unknown as Record<string, unknown>,
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
    if (asset === 'USDT' || asset === 'USDC' || asset === 'USD') return 1

    const query = new URLSearchParams({ currency_pair: `${asset}_USDT` })
    const response = await fetchWithRetry(`${BASE_URL}/spot/tickers?${query.toString()}`)
    if (!response.ok) return 0

    const data = (await response.json()) as unknown
    if (!Array.isArray(data) || data.length === 0) return 0

    const first = data[0] as Record<string, unknown>
    const last = asNumber(first.last)
    return last > 0 ? last : 0
  }
}

type GateSpotAccount = {
  currency?: string
  available?: string
  locked?: string
}

type GateSpotTrade = {
  id?: string
  order_id?: string
  currency_pair?: string
  side?: string
  amount?: string
  size?: string
  price?: string
  fee?: string
  fee_currency?: string
  create_time?: string
  create_time_ms?: string
}

type GateFuturesTrade = {
  id?: string
  order_id?: string
  contract?: string
  side?: string
  size?: string
  qty?: string
  price?: string
  fee?: string
  fee_currency?: string
  settle?: string
  pnl?: string
  create_time?: string
  create_time_ms?: string
}

type GatePositionClose = {
  id?: string
  order_id?: string
  contract?: string
  side?: string
  size?: string
  fee?: string
  fee_currency?: string
  settle?: string
  pnl?: string
  close_pnl?: string
  realized_pnl?: string
  funding_fee?: string
  close_time?: string
  close_time_ms?: string
  time?: string
  time_ms?: string
}

type GateFuturesPosition = {
  contract?: string
  size?: string
  position_size?: string
  entry_price?: string
  avg_entry_price?: string
  mark_price?: string
  unrealised_pnl?: string
  unrealized_pnl?: string
  leverage?: string
}

type GateFuturesContract = {
  name?: string
  quanto_multiplier?: string
  multiplier?: string
}

type GateFuturesContractSpec = {
  multiplier: number
}
