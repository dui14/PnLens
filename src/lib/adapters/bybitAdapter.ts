import { HistoryGapTracker, type HistoryGap } from './historyGaps'
import { keyObjectFromSecret, signAsymmetricKey } from './pemPrivateKey'
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
import { throwOnServerPage } from './exchangeWindowError'
import {
  TradeRejectCounter,
  addDecimals,
  decimalOrZero,
  flexibleTimeToIso,
  optionalDecimal,
  requiredDecimal,
  venueDecimal,
  type TradeRejectCounts,
} from './tradeFields'

import { BYBIT_BASE_URL as BASE_URL } from './exchangeBases'
import { DAY_MS, HISTORY_RETRY, SCAN_LOOKBACK_MS } from '@/lib/scan/scanLimits'
const REQUEST_TIMEOUT = 10_000
const RECV_WINDOW = '5000'
const DEFAULT_LOOKBACK_MS = SCAN_LOOKBACK_MS
const BYBIT_HISTORY_WINDOW_MS = 7 * DAY_MS

function sign(apiKey: string, secret: string, timestamp: number, queryString: string): string {
  const payload = `${timestamp}${apiKey}${RECV_WINDOW}${queryString}`
  return signAsymmetricKey('bybit', payload, keyObjectFromSecret(secret))
}

type RequestInitWithProxy = RequestInit & { proxy?: string | null }

type RequestSource = RequestInit | (() => RequestInit)

function resolveRequest(source?: RequestSource): RequestInit | undefined {
  return typeof source === 'function' ? source() : source
}

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
  options?: RequestSource,
  attempt = 0,
  proxy?: string | null
): Promise<Response> {
  const resolved = resolveRequest(options)
  const response = await fetchWithTimeout(
    url,
    proxy
      ? ({
          ...(resolved ?? {}),
          proxy,
        } as RequestInitWithProxy)
      : resolved
  )
  if (attempt < HISTORY_RETRY.maxAttempts && (response.status === 429 || (await isBodyRateLimited(response)))) {
    const backoff = Math.min(Math.pow(2, attempt) * HISTORY_RETRY.baseDelayMs, HISTORY_RETRY.maxDelayMs)
    await sleep(backoff + Math.random() * 500)
    return fetchWithRetry(url, options, attempt + 1, proxy)
  }
  return response
}

async function isBodyRateLimited(response: Response): Promise<boolean> {
  if (!response.ok) return false
  try {
    const body = (await response.clone().json()) as { retCode?: number }
    return body?.retCode === HISTORY_RETRY.bybitRateLimitCode
  } catch {
    return false
  }
}

export class BybitAdapter implements ExchangeAdapter {
  private proxy: string | null = null
  private readonly rejections = new TradeRejectCounter()
  private readonly gaps = new HistoryGapTracker()

  historyGaps(): HistoryGap[] {
    return this.gaps.gaps
  }


  rejectedTradeCounts(): TradeRejectCounts {
    return this.rejections.counts
  }

  private async withProxy<T>(
    _credentials: ExchangeCredentials,
    fn: () => Promise<T>
  ): Promise<T> {
    return fn()
  }

  private async fetchWithRetry(url: string, options?: RequestSource): Promise<Response> {
    return fetchWithRetry(url, options, 0, this.proxy)
  }

  private buildHeaders(credentials: ExchangeCredentials, queryString: string): Record<string, string> {
    const timestamp = Date.now()
    const signature = sign(credentials.apiKey, credentials.apiSecret, timestamp, queryString)
    return {
      'X-BAPI-API-KEY': credentials.apiKey,
      'X-BAPI-SIGN': signature,
      'X-BAPI-TIMESTAMP': String(timestamp),
      'X-BAPI-RECV-WINDOW': RECV_WINDOW,
    }
  }

  async validateCredentials(credentials: ExchangeCredentials): Promise<CredentialProbeResult> {
    if (!credentials.apiSecret.trim()) return probeFailure('INVALID_SECRET_OR_PASSPHRASE')
    try {
      const queryString = ''
      const request = () => ({ headers: this.buildHeaders(credentials, queryString) })
      const response = await fetchWithRetry(`${BASE_URL}/v5/user/query-api`, request, 0, null)
      return interpretBybitQueryApi(response.status, await readJson(response))
    } catch (error) {
      if (error instanceof Error && error.message === 'UNSUPPORTED_SIGNING_KEY') {
        return probeFailure('INVALID_SECRET_OR_PASSPHRASE')
      }
      return probeFailure('EXCHANGE_UNREACHABLE')
    }
  }

  async hasWithdrawPermission(credentials: ExchangeCredentials): Promise<boolean> {
    return this.withProxy(credentials, async () => {
      try {
        const queryString = ''
        const request = () => ({ headers: this.buildHeaders(credentials, queryString) })
        const response = await this.fetchWithRetry(`${BASE_URL}/v5/user/query-api`, request)
        if (!response.ok) return false
        const data = (await response.json()) as { retCode: number; result?: { permissions?: { Withdraw?: boolean } } }
        if (data.retCode !== 0) return false
        return Boolean(data.result?.permissions?.Withdraw)
      } catch {
        return false
      }
    })
  }

  private scanEndMs = 0

  async fetchTrades(credentials: ExchangeCredentials, since?: Date, until?: Date): Promise<ExchangeAdapterTrade[]> {
    this.scanEndMs = until?.getTime() ?? Date.now()
    this.rejections.reset()
    this.gaps.reset()
    return this.withProxy(credentials, async () => {
      const startTime = since ? since.getTime() : Date.now() - DEFAULT_LOOKBACK_MS
      const now = this.scanEndMs
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
              const request = () => ({ headers: this.buildHeaders(credentials, queryString) })
              const response = await this.fetchWithRetry(`${BASE_URL}/v5/execution/list?${queryString}`, request)
              throwOnServerPage(response)
          if (!response.ok) { this.gaps.record(category, windowStart, windowEnd); break }

              const data = (await response.json()) as {
                retCode: number
                result?: { list?: BybitTrade[]; nextPageCursor?: string }
              }
              if (data.retCode !== 0) { this.gaps.record(category, windowStart, windowEnd); break }

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

          const normalizedTrades = allTrades.flatMap((trade) => {
            const normalized = this.normalizeTrade(trade, tradeType)
            return normalized ? [normalized] : []
          })
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
      const request = () => ({ headers: this.buildHeaders(credentials, queryString) })
      const response = await this.fetchWithRetry(`${BASE_URL}/v5/position/list?${queryString}`, request)

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
      const request = () => ({ headers: this.buildHeaders(credentials, queryString) })
      const response = await this.fetchWithRetry(`${BASE_URL}/v5/account/wallet-balance?${queryString}`, request)

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

  private normalizeTrade(trade: BybitTrade, tradeType: 'spot' | 'futures'): ExchangeAdapterTrade | null {
    const tradedAt = flexibleTimeToIso(trade.execTime)
    if (!tradedAt) return this.rejections.reject('INVALID_TIMESTAMP')
    const externalTradeId = String(trade.execId ?? '').trim()
    if (!externalTradeId) return this.rejections.reject('MISSING_ID')
    const quantity = requiredDecimal(trade.execQty, this.rejections)
    if (!quantity) return null
    const price = requiredDecimal(trade.execPrice, this.rejections)
    if (!price) return null
    const fee = decimalOrZero(trade.execFee, this.rejections)
    if (!fee) return null
    const realizedPnl = optionalDecimal(trade.closedPnl, this.rejections)
    if (realizedPnl === undefined) return null
    return {
      external_trade_id: externalTradeId,
      symbol: trade.symbol,
      side: (trade.side ?? 'Buy').toLowerCase() === 'buy' ? 'buy' : 'sell',
      quantity,
      price,
      fee,
      fee_currency: trade.feeCurrency ?? 'USDT',
      realized_pnl: realizedPnl,
      funding_fee: '0',
      income_type: trade.execType ?? null,
      trade_type: tradeType,
      traded_at: tradedAt,
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
        const request = () => ({ headers: this.buildHeaders(credentials, queryString) })
        const response = await this.fetchWithRetry(`${BASE_URL}/v5/position/closed-pnl?${queryString}`, request)

        throwOnServerPage(response)
          if (!response.ok) { this.gaps.record(`closed_pnl_${category}`, windowStart, windowEnd); break }

        const data = (await response.json()) as {
          retCode: number
          result?: { list?: BybitClosedPnl[]; nextPageCursor?: string }
        }
        if (data.retCode !== 0) { this.gaps.record(`closed_pnl_${category}`, windowStart, windowEnd); break }

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
    const pnlByOrderId = new Map<string, string>()
    const syntheticRows: ExchangeAdapterTrade[] = []

    for (const row of closedRows) {
      const pnl = optionalDecimal(row.closedPnl, this.rejections)
      if (pnl === undefined || pnl === null) continue

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

      const pnl = venueDecimal(row.closedPnl ?? '')
      if (!pnl) continue

      const normalized = this.normalizeClosedPnlRow(row, pnl)
      if (normalized) {
        syntheticRows.push(normalized)
      }
    }

    return [...patchedTrades, ...syntheticRows]
  }

  private normalizeClosedPnlRow(row: BybitClosedPnl, pnl: string): ExchangeAdapterTrade | null {
    if (!row.symbol) return null

    const side = (row.side ?? '').toLowerCase() === 'sell' ? 'sell' : 'buy'
    const closeSize = decimalOrZero(row.closedSize, this.rejections)
    if (!closeSize) return null
    const closePrice = decimalOrZero(row.avgExitPrice, this.rejections)
    if (!closePrice) return null
    const openFee = decimalOrZero(row.openFee, this.rejections)
    if (!openFee) return null
    const closeFee = decimalOrZero(row.closeFee, this.rejections)
    if (!closeFee) return null
    const fee = addDecimals(openFee, closeFee)
    if (!fee) return this.rejections.reject('INVALID_NUMBER')
    const fundingFee = decimalOrZero(row.totalFundingFee, this.rejections)
    if (!fundingFee) return null
    const timestamp = row.updatedTime ?? row.createdTime
    const tradedAt = flexibleTimeToIso(timestamp)
    if (!tradedAt || !timestamp) return this.rejections.reject('INVALID_TIMESTAMP')
    const externalTradeId = row.orderId
      ? `closed_pnl_${row.orderId}_${timestamp}`
      : `closed_pnl_${row.symbol}_${timestamp}`

    return {
      external_trade_id: externalTradeId,
      symbol: row.symbol,
      side,
      quantity: closeSize,
      price: closePrice,
      fee,
      fee_currency: row.settleCoin ?? 'USDT',
      realized_pnl: pnl,
      funding_fee: fundingFee,
      income_type: 'closed_pnl',
      trade_type: 'futures',
      traded_at: tradedAt,
      raw_data: row as unknown as Record<string, unknown>,
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
