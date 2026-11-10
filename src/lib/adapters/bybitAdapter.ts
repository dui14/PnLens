import { createHmac } from 'crypto'
import type {
  ExchangeAdapterTrade,
  ExchangeCredentials,
  AssetBalance,
  UnrealizedPosition,
} from '@/lib/types'
import { type ExchangeAdapter } from './exchangeFactory'
import {
  interpretBybitQueryApi,
  probeFailure,
  readJson,
  type CredentialProbeResult,
} from './credentialValidation'
import { fetchExchange } from './httpClient'

import { BYBIT_BASE_URL as BASE_URL } from './exchangeBases'
const REQUEST_TIMEOUT = 10_000
const RECV_WINDOW = '5000'
const DEFAULT_LOOKBACK_MS = 365 * 24 * 60 * 60 * 1000
const BYBIT_HISTORY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000

function sign(apiKey: string, secret: string, timestamp: number, queryString: string): string {
  const payload = `${timestamp}${apiKey}${RECV_WINDOW}${queryString}`
  return createHmac('sha256', secret).update(payload).digest('hex')
}

type RequestInitWithProxy = RequestInit & { proxy?: string | null }

async function fetchWithTimeout(url: string, options?: RequestInitWithProxy): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT)
  try {
    return await fetchExchange(url, {
      ...options,
      signal: controller.signal,
      proxy: options?.proxy ? String(options.proxy) : null,
    })
  } finally {
    clearTimeout(timer)
  }
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function fetchWithRetry(
  url: string,
  options?: RequestInitWithProxy,
  attempt = 0,
  proxy?: string | null
): Promise<Response> {
  const response = await fetchWithTimeout(
    url,
    proxy
      ? ({
          ...(options ?? {}),
          proxy,
        } as RequestInitWithProxy)
      : options
  )
  if (response.status === 429 && attempt < 4) {
    const backoff = Math.min(Math.pow(2, attempt) * 1000, 60_000)
    await sleep(backoff + Math.random() * 500)
    return fetchWithRetry(url, options, attempt + 1, proxy)
  }
  return response
}

export class BybitAdapter implements ExchangeAdapter {
  private proxy: string | null = null

  private async withProxy<T>(
    _credentials: ExchangeCredentials,
    fn: () => Promise<T>
  ): Promise<T> {
    return fn()
  }

  private async fetchWithRetry(url: string, options?: RequestInit): Promise<Response> {
    return fetchWithRetry(url, options, 0, this.proxy)
  }

  private buildHeaders(credentials: ExchangeCredentials, queryString: string): Record<string, string> {
    const timestamp = Date.now()
    const signature = sign(credentials.apiKey, credentials.apiSecret, timestamp, queryString)
    return {
      'X-BAPI-API-KEY': credentials.apiKey,
      'X-BAPI-SIGN': signature,
      'X-BAPI-SIGN-TYPE': '2',
      'X-BAPI-TIMESTAMP': String(timestamp),
      'X-BAPI-RECV-WINDOW': RECV_WINDOW,
    }
  }

  async validateCredentials(credentials: ExchangeCredentials): Promise<CredentialProbeResult> {
    try {
      const queryString = ''
      const headers = this.buildHeaders(credentials, queryString)
      const response = await fetchWithRetry(`${BASE_URL}/v5/user/query-api`, { headers }, 0, null)
      return interpretBybitQueryApi(response.status, await readJson(response))
    } catch {
      return probeFailure('EXCHANGE_UNREACHABLE')
    }
  }

  async hasWithdrawPermission(credentials: ExchangeCredentials): Promise<boolean> {
    return this.withProxy(credentials, async () => {
      try {
        const queryString = ''
        const headers = this.buildHeaders(credentials, queryString)
        const response = await this.fetchWithRetry(`${BASE_URL}/v5/user/query-api`, { headers })
        if (!response.ok) return false
        const data = (await response.json()) as { retCode: number; result?: { permissions?: { Withdraw?: boolean } } }
        if (data.retCode !== 0) return false
        return Boolean(data.result?.permissions?.Withdraw)
      } catch {
        return false
      }
    })
  }

  async fetchTrades(credentials: ExchangeCredentials, since?: Date): Promise<ExchangeAdapterTrade[]> {
    return this.withProxy(credentials, async () => {
      const startTime = since ? since.getTime() : Date.now() - DEFAULT_LOOKBACK_MS
      const now = Date.now()
      const categories: Array<{ category: 'spot' | 'linear' | 'inverse'; tradeType: 'spot' | 'futures' }> = [
        { category: 'spot', tradeType: 'spot' },
        { category: 'linear', tradeType: 'futures' },
        { category: 'inverse', tradeType: 'futures' },
      ]

      const batches = await Promise.all(
        categories.map(async ({ category, tradeType }) => {
          const allTrades: BybitTrade[] = []
          const dedup = new Set<string>()
          let windowStart = startTime

          while (windowStart <= now) {
            const windowEnd = Math.min(windowStart + BYBIT_HISTORY_WINDOW_MS - 1, now)
            let cursor = ''

            for (let page = 0; page < 50; page += 1) {
              const query = new URLSearchParams({
                category,
                startTime: String(windowStart),
                endTime: String(windowEnd),
                limit: '100',
              })
              if (cursor) query.set('cursor', cursor)

              const queryString = query.toString()
              const headers = this.buildHeaders(credentials, queryString)
              const response = await this.fetchWithRetry(`${BASE_URL}/v5/execution/list?${queryString}`, { headers })
              if (!response.ok) break

              const data = (await response.json()) as {
                retCode: number
                result?: { list?: BybitTrade[]; nextPageCursor?: string }
              }
              if (data.retCode !== 0) break

              const pageTrades = data.result?.list ?? []
              for (const trade of pageTrades) {
                const dedupKey = trade.execId || `${trade.symbol}:${trade.execTime}:${trade.execQty}`
                if (dedup.has(dedupKey)) continue
                dedup.add(dedupKey)
                allTrades.push(trade)
              }

              cursor = data.result?.nextPageCursor ?? ''
              if (!cursor || pageTrades.length < 100) break
              await sleep(80)
            }

            windowStart = windowEnd + 1
            await sleep(80)
          }

          const normalizedTrades = allTrades.map((trade) => this.normalizeTrade(trade, tradeType))
          if (tradeType !== 'futures') {
            return normalizedTrades
          }

          const futuresCategory: 'linear' | 'inverse' = category === 'inverse' ? 'inverse' : 'linear'
          const closedPnlRows = await this.fetchClosedPnlEvents(
            credentials,
            futuresCategory,
            startTime,
            now
          )
          return this.mergeFuturesTradesWithClosedPnl(normalizedTrades, closedPnlRows)
        })
      )

      return this.deduplicateTrades(batches.flat())
    })
  }

  async fetchOpenPositions(credentials: ExchangeCredentials): Promise<UnrealizedPosition[]> {
    return this.withProxy(credentials, async () => {
      const queryString = 'category=linear&settleCoin=USDT'
      const headers = this.buildHeaders(credentials, queryString)
      const response = await this.fetchWithRetry(`${BASE_URL}/v5/position/list?${queryString}`, { headers })

      if (!response.ok) return []

      const data = (await response.json()) as { retCode: number; result?: { list?: BybitPosition[] } }
      if (data.retCode !== 0) return []

      return (data.result?.list ?? [])
        .filter((position) => Math.abs(parseFloat(position.size ?? '0')) > 0)
        .map((position) => ({
          symbol: position.symbol,
          side: (position.side ?? '').toLowerCase() === 'sell' ? 'short' : 'long',
          size: Math.abs(parseFloat(position.size)),
          entryPrice: parseFloat(position.avgPrice ?? '0'),
          markPrice: parseFloat(position.markPrice ?? '0'),
          unrealizedPnl: parseFloat(position.unrealisedPnl ?? '0'),
          leverage: parseFloat(position.leverage ?? '0') || 1,
          tradeType: 'futures',
        }))
    })
  }

  async fetchBalances(credentials: ExchangeCredentials): Promise<AssetBalance[]> {
    return this.withProxy(credentials, async () => {
      const queryString = 'accountType=UNIFIED'
      const headers = this.buildHeaders(credentials, queryString)
      const response = await this.fetchWithRetry(`${BASE_URL}/v5/account/wallet-balance?${queryString}`, { headers })

      if (!response.ok) return []

      const data = (await response.json()) as {
        retCode: number
        result?: { list?: Array<{ coin?: Array<{ coin: string; walletBalance: string; locked: string }> }> }
      }
      if (data.retCode !== 0) return []

      const balances: AssetBalance[] = []
      for (const account of data.result?.list ?? []) {
        for (const coin of account.coin ?? []) {
          const free = parseFloat(coin.walletBalance)
          const locked = parseFloat(coin.locked ?? '0')
          const total = free + locked
          if (total <= 0) continue
          const price = await this.getUsdPrice(coin.coin)
          balances.push({
            asset: coin.coin,
            free,
            locked,
            usdValue: total * price,
          })
        }
      }

      return balances
    })
  }

  private normalizeTrade(trade: BybitTrade, tradeType: 'spot' | 'futures'): ExchangeAdapterTrade {
    return {
      external_trade_id: trade.execId,
      symbol: trade.symbol,
      side: (trade.side ?? 'Buy').toLowerCase() === 'buy' ? 'buy' : 'sell',
      quantity: parseFloat(trade.execQty ?? '0'),
      price: parseFloat(trade.execPrice ?? '0'),
      fee: parseFloat(trade.execFee ?? '0'),
      fee_currency: trade.feeCurrency ?? 'USDT',
      realized_pnl: trade.closedPnl ? parseFloat(trade.closedPnl) : null,
      funding_fee: 0,
      income_type: trade.execType ?? null,
      trade_type: tradeType,
      traded_at: this.toIsoTimestamp(trade.execTime),
      raw_data: trade as unknown as Record<string, unknown>,
    }
  }

  private async fetchClosedPnlEvents(
    credentials: ExchangeCredentials,
    category: 'linear' | 'inverse',
    startTime: number,
    now: number
  ): Promise<BybitClosedPnl[]> {
    const rows: BybitClosedPnl[] = []
    let windowStart = startTime

    while (windowStart <= now) {
      const windowEnd = Math.min(windowStart + BYBIT_HISTORY_WINDOW_MS - 1, now)
      let cursor = ''

      for (let page = 0; page < 50; page += 1) {
        const query = new URLSearchParams({
          category,
          startTime: String(windowStart),
          endTime: String(windowEnd),
          limit: '100',
        })
        if (cursor) query.set('cursor', cursor)

        const queryString = query.toString()
        const headers = this.buildHeaders(credentials, queryString)
        const response = await this.fetchWithRetry(`${BASE_URL}/v5/position/closed-pnl?${queryString}`, {
          headers,
        })

        if (!response.ok) break

        const data = (await response.json()) as {
          retCode: number
          result?: { list?: BybitClosedPnl[]; nextPageCursor?: string }
        }
        if (data.retCode !== 0) break

        const list = data.result?.list ?? []
        if (list.length === 0) break

        rows.push(...list)

        cursor = data.result?.nextPageCursor ?? ''
        if (!cursor || list.length < 100) break
        await sleep(80)
      }

      windowStart = windowEnd + 1
      await sleep(80)
    }

    return rows
  }

  private mergeFuturesTradesWithClosedPnl(
    trades: ExchangeAdapterTrade[],
    closedRows: BybitClosedPnl[]
  ): ExchangeAdapterTrade[] {
    const pnlByOrderId = new Map<string, number>()
    const syntheticRows: ExchangeAdapterTrade[] = []

    for (const row of closedRows) {
      const pnl = this.parseOptionalNumber(row.closedPnl)
      if (pnl === null) continue

      if (row.orderId) {
        if (!pnlByOrderId.has(row.orderId)) {
          pnlByOrderId.set(row.orderId, pnl)
        }
        continue
      }

      const normalized = this.normalizeClosedPnlRow(row, pnl)
      if (normalized) {
        syntheticRows.push(normalized)
      }
    }

    const matchedOrderIds = new Set<string>()
    const patchedTrades = trades.map((trade) => {
      if (trade.realized_pnl !== null) return trade

      const raw = (trade.raw_data ?? {}) as Record<string, unknown>
      const orderId =
        (typeof raw.orderId === 'string' && raw.orderId) ||
        (typeof raw.order_id === 'string' && raw.order_id) ||
        ''
      if (!orderId) return trade

      const mappedPnl = pnlByOrderId.get(orderId)
      if (mappedPnl === undefined) return trade

      matchedOrderIds.add(orderId)
      return {
        ...trade,
        realized_pnl: mappedPnl,
        income_type: trade.income_type ?? 'closed_pnl',
      }
    })

    for (const row of closedRows) {
      if (!row.orderId || matchedOrderIds.has(row.orderId)) continue

      const pnl = this.parseOptionalNumber(row.closedPnl)
      if (pnl === null) continue

      const normalized = this.normalizeClosedPnlRow(row, pnl)
      if (normalized) {
        syntheticRows.push(normalized)
      }
    }

    return [...patchedTrades, ...syntheticRows]
  }

  private normalizeClosedPnlRow(row: BybitClosedPnl, pnl: number): ExchangeAdapterTrade | null {
    if (!row.symbol) return null

    const side = (row.side ?? '').toLowerCase() === 'sell' ? 'sell' : 'buy'
    const closeSize = this.parseOptionalNumber(row.closedSize) ?? 0
    const closePrice = this.parseOptionalNumber(row.avgExitPrice) ?? 0
    const openFee = this.parseOptionalNumber(row.openFee) ?? 0
    const closeFee = this.parseOptionalNumber(row.closeFee) ?? 0
    const fundingFee = this.parseOptionalNumber(row.totalFundingFee) ?? 0
    const timestamp = row.updatedTime ?? row.createdTime ?? String(Date.now())
    const externalTradeId = row.orderId
      ? `closed_pnl_${row.orderId}_${timestamp}`
      : `closed_pnl_${row.symbol}_${timestamp}`

    return {
      external_trade_id: externalTradeId,
      symbol: row.symbol,
      side,
      quantity: Math.abs(closeSize),
      price: closePrice,
      fee: Math.abs(openFee + closeFee),
      fee_currency: row.settleCoin ?? 'USDT',
      realized_pnl: pnl,
      funding_fee: fundingFee,
      income_type: 'closed_pnl',
      trade_type: 'futures',
      traded_at: this.toIsoTimestamp(timestamp),
      raw_data: row as unknown as Record<string, unknown>,
    }
  }

  private parseOptionalNumber(value: string | undefined): number | null {
    if (value === undefined || value === null || value === '') return null
    const parsed = Number(value)
    if (!Number.isFinite(parsed)) return null
    return parsed
  }

  private toIsoTimestamp(value: string): string {
    const parsed = Number(value)
    if (!Number.isFinite(parsed)) return new Date().toISOString()
    const millis = parsed > 1_000_000_000_000 ? parsed : parsed * 1000
    return new Date(millis).toISOString()
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
    try {
      const queryString = `category=spot&symbol=${asset}USDT`
      const response = await this.fetchWithRetry(`${BASE_URL}/v5/market/tickers?${queryString}`)
      if (!response.ok) return 0
      const data = (await response.json()) as {
        retCode: number
        result?: { list?: Array<{ lastPrice?: string }> }
      }
      if (data.retCode !== 0) return 0
      return data.result?.list?.[0]?.lastPrice ? parseFloat(data.result.list[0].lastPrice) : 0
    } catch {
      return 0
    }
  }
}

type BybitTrade = {
  execId: string
  orderId?: string
  symbol: string
  side: string
  execQty: string
  execPrice: string
  execFee: string
  feeCurrency?: string
  closedPnl?: string
  execType?: string
  execTime: string
}

type BybitClosedPnl = {
  orderId?: string
  symbol?: string
  side?: string
  settleCoin?: string
  closedPnl?: string
  closedSize?: string
  avgExitPrice?: string
  openFee?: string
  closeFee?: string
  totalFundingFee?: string
  createdTime?: string
  updatedTime?: string
}

type BybitPosition = {
  symbol: string
  side: string
  size: string
  avgPrice: string
  markPrice: string
  unrealisedPnl: string
  leverage: string
}
