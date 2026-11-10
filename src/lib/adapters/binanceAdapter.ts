import { createHmac } from 'crypto'
import type {
  ExchangeAdapterTrade,
  ExchangeCredentials,
  AssetBalance,
  UnrealizedPosition,
} from '@/lib/types'
import { type ExchangeAdapter } from './exchangeFactory'
import {
  interpretBinanceRestrictions,
  probeFailure,
  readJson,
  type CredentialProbeResult,
} from './credentialValidation'
import { BINANCE_BASE_URL as BASE_URL, BINANCE_FUTURES_BASE_URL as FUTURES_URL } from './exchangeBases'
import { fetchExchange } from './httpClient'
import { throwOnServerPage } from './exchangeWindowError'
import {
  TradeRejectCounter,
  epochMillisToIso,
  optionalDecimal,
  requiredDecimal,
  type TradeRejectCounts,
} from './tradeFields'
const REQUEST_TIMEOUT = 10_000
const RECV_WINDOW = 10_000
const DEFAULT_LOOKBACK_MS = 365 * 24 * 60 * 60 * 1000
const QUOTE_ASSETS = ['USDT', 'BUSD', 'USDC', 'BTC', 'ETH', 'BNB']
const STABLE_ASSETS = new Set(['USDT', 'BUSD', 'USDC', 'FDUSD', 'DAI', 'TUSD'])
const FUTURES_INCOME_CHUNK_MS = 7 * 24 * 60 * 60 * 1000
const FUTURES_USER_TRADES_WINDOW_MS = 7 * 24 * 60 * 60 * 1000
const FUTURES_USER_TRADES_LOOKBACK_MS = 365 * 24 * 60 * 60 * 1000
const FUTURES_INCOME_TYPES = ['REALIZED_PNL', 'FUNDING_FEE', 'COMMISSION'] as const
const EARN_ASSET_PREFIXES = ['LD', 'BVOL', 'DVOL']
const LEVERAGED_SUFFIXES = ['UP', 'DOWN', 'BEAR', 'BULL', '3L', '3S', '2L', '2S']
const COMMON_BASE_ASSETS = [
  'BTC', 'ETH', 'BNB', 'SOL', 'XRP', 'ADA', 'MATIC', 'DOGE', 'DOT', 'AVAX',
  'LINK', 'UNI', 'ATOM', 'LTC', 'NEAR', 'FIL', 'ALGO', 'OP', 'ARB', 'APT',
  'SUI', 'PEPE', 'SHIB', 'TRX', 'TON', 'BAND', 'HOME', 'WAL',
]

function isSyntheticAsset(asset: string): boolean {
  if (EARN_ASSET_PREFIXES.some((prefix) => asset.startsWith(prefix))) return true
  if (LEVERAGED_SUFFIXES.some((suffix) => asset.endsWith(suffix))) return true
  return false
}

function sign(queryString: string, secret: string): string {
  return createHmac('sha256', secret).update(queryString).digest('hex')
}

type RequestInitWithProxy = RequestInit & { proxy?: string | null }

async function fetchWithTimeout(url: string, options?: RequestInitWithProxy): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT)
  try {
    const response = await fetchExchange(url, {
      ...options,
      signal: controller.signal,
      proxy: options?.proxy ? String(options.proxy) : null,
    })
    return response
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
        } as RequestInit)
      : options
  )
  if (response.status === 429 && attempt < 4) {
    const backoff = Math.min(Math.pow(2, attempt) * 1000, 60_000)
    await sleep(backoff + Math.random() * 500)
    return fetchWithRetry(url, options, attempt + 1, proxy)
  }
  return response
}

export class BinanceAdapter implements ExchangeAdapter {
  private proxy: string | null = null
  private readonly rejections = new TradeRejectCounter()

  rejectedTradeCounts(): TradeRejectCounts {
    return this.rejections.counts
  }

  private restrictionsCache:
    | {
        apiKey: string
        expiresAt: number
        data: BinanceApiRestrictions
      }
    | null = null

  private async withProxy<T>(
    _credentials: ExchangeCredentials,
    fn: () => Promise<T>
  ): Promise<T> {
    return fn()
  }

  private async fetchWithRetry(
    url: string,
    options?: RequestInit
  ): Promise<Response> {
    return fetchWithRetry(url, options, 0, this.proxy)
  }

  async validateCredentials(credentials: ExchangeCredentials): Promise<CredentialProbeResult> {
    try {
      const params = new URLSearchParams({
        timestamp: String(Date.now()),
        recvWindow: String(RECV_WINDOW),
      })
      params.append('signature', sign(params.toString(), credentials.apiSecret))
      const response = await fetchWithRetry(
        `${BASE_URL}/sapi/v1/account/apiRestrictions?${params.toString()}`,
        { headers: { 'X-MBX-APIKEY': credentials.apiKey } },
        0,
        null
      )
      return interpretBinanceRestrictions(response.status, await readJson(response))
    } catch {
      return probeFailure('EXCHANGE_UNREACHABLE')
    }
  }

  async hasWithdrawPermission(credentials: ExchangeCredentials): Promise<boolean> {
    return this.withProxy(credentials, async () => {
      try {
        const restrictions = await this.fetchApiRestrictions(credentials)
        if (!restrictions.ok || !restrictions.data) return false

        const data = restrictions.data

        if (typeof data.enableWithdrawals === 'boolean') {
          return data.enableWithdrawals
        }

        if (typeof data.canWithdraw === 'boolean') {
          return data.canWithdraw
        }

        if (typeof data.isWithdrawEnabled === 'boolean') {
          return data.isWithdrawEnabled
        }

        return false
      } catch {
        return false
      }
    })
  }

  private async fetchApiRestrictions(
    credentials: ExchangeCredentials
  ): Promise<{ ok: boolean; data?: BinanceApiRestrictions }> {
    const cached = this.getRestrictionsCache(credentials.apiKey)
    if (cached) {
      return { ok: true, data: cached }
    }

    const firstAttempt = await this.requestApiRestrictions(credentials)
    if (firstAttempt.ok && firstAttempt.data) {
      this.setRestrictionsCache(credentials.apiKey, firstAttempt.data)
      return { ok: true, data: firstAttempt.data }
    }

    if (firstAttempt.errorCode === -1021) {
      const serverTime = await this.fetchServerTime()
      if (serverTime !== null) {
        const retried = await this.requestApiRestrictions(credentials, serverTime)
        if (retried.ok && retried.data) {
          this.setRestrictionsCache(credentials.apiKey, retried.data)
          return { ok: true, data: retried.data }
        }
      }
    }

    return { ok: false }
  }

  private getRestrictionsCache(apiKey: string): BinanceApiRestrictions | null {
    if (!this.restrictionsCache) return null
    if (this.restrictionsCache.apiKey !== apiKey) return null
    if (Date.now() >= this.restrictionsCache.expiresAt) return null
    return this.restrictionsCache.data
  }

  private setRestrictionsCache(apiKey: string, data: BinanceApiRestrictions): void {
    this.restrictionsCache = {
      apiKey,
      expiresAt: Date.now() + 60_000,
      data,
    }
  }

  private async requestApiRestrictions(
    credentials: ExchangeCredentials,
    timestampOverride?: number
  ): Promise<{ ok: boolean; data?: BinanceApiRestrictions; errorCode?: number }> {
    try {
      const timestamp = timestampOverride ?? Date.now()
      const params = new URLSearchParams({
        timestamp: String(timestamp),
        recvWindow: String(RECV_WINDOW),
      })
      params.append('signature', sign(params.toString(), credentials.apiSecret))

      const response = await this.fetchWithRetry(
        `${BASE_URL}/sapi/v1/account/apiRestrictions?${params.toString()}`,
        { headers: { 'X-MBX-APIKEY': credentials.apiKey } }
      )

      if (response.ok) {
        const data = (await response.json()) as BinanceApiRestrictions
        return { ok: true, data }
      }

      const errorPayload = (await response.json()) as { code?: number }
      return { ok: false, errorCode: errorPayload.code }
    } catch {
      return { ok: false }
    }
  }

  private async fetchServerTime(): Promise<number | null> {
    try {
      const response = await this.fetchWithRetry(`${BASE_URL}/api/v3/time`)
      if (!response.ok) return null
      const data = (await response.json()) as { serverTime?: number }
      return typeof data.serverTime === 'number' ? data.serverTime : null
    } catch {
      return null
    }
  }

  private scanEndMs = 0

  async fetchTrades(
    credentials: ExchangeCredentials,
    since?: Date,
    until?: Date
  ): Promise<ExchangeAdapterTrade[]> {
    this.scanEndMs = until?.getTime() ?? Date.now()
    this.rejections.reset()
    return this.withProxy(credentials, async () => {
      const [spotTrades, futuresTrades] = await Promise.all([
        this.fetchSpotTrades(credentials.apiKey, credentials.apiSecret, since),
        this.fetchFuturesTrades(credentials.apiKey, credentials.apiSecret, since),
      ])
      return [...spotTrades, ...futuresTrades]
    })
  }

  private async fetchSpotTrades(
    apiKey: string,
    apiSecret: string,
    since?: Date
  ): Promise<ExchangeAdapterTrade[]> {
    const startTime = since ? since.getTime() : Date.now() - DEFAULT_LOOKBACK_MS

    const balances = await this.fetchBalances({ apiKey, apiSecret })
    const tradableAssets = balances.map((item) => item.asset).filter(
      (a) => !STABLE_ASSETS.has(a) && !isSyntheticAsset(a)
    )

    const symbolsToQuery = new Set<string>()
    for (const asset of tradableAssets) {
      for (const quote of QUOTE_ASSETS) {
        if (asset !== quote) symbolsToQuery.add(`${asset}${quote}`)
      }
    }

    for (const base of COMMON_BASE_ASSETS) {
      symbolsToQuery.add(`${base}USDT`)
    }

    const allTrades: ExchangeAdapterTrade[] = []
    for (const symbol of symbolsToQuery) {
      await sleep(80)
      const trades = await this.fetchSpotTradesForSymbol(apiKey, apiSecret, symbol, startTime)
      allTrades.push(...trades)
    }
    return this.deduplicateFuturesTrades(allTrades)
  }

  private async fetchSpotTradesForSymbol(
    apiKey: string,
    apiSecret: string,
    symbol: string,
    startTime: number
  ): Promise<ExchangeAdapterTrade[]> {
    const timestamp = Date.now()
    const params = new URLSearchParams({
      symbol,
      limit: '1000',
      startTime: String(startTime),
      timestamp: String(timestamp),
    })
    params.append('signature', sign(params.toString(), apiSecret))

    const response = await this.fetchWithRetry(`${BASE_URL}/api/v3/myTrades?${params}`, {
      headers: { 'X-MBX-APIKEY': apiKey },
    })

    if (!response.ok) {
      throwOnServerPage(response)
      const err = (await response.json()) as { code?: number }
      if (err?.code === -1121) return []
      console.error(`[BinanceAdapter] fetchSpotTradesForSymbol failed for ${symbol}:`, err)
      return []
    }

    const data = (await response.json()) as BinanceSpotTrade[]
    const trades: ExchangeAdapterTrade[] = []
    for (const row of data) {
      const normalized = this.normalizeSpotTrade(row)
      if (normalized) trades.push(normalized)
    }
    return trades
  }

  private async fetchFuturesTrades(
    apiKey: string,
    apiSecret: string,
    since?: Date
  ): Promise<ExchangeAdapterTrade[]> {
    const startTime = since ? since.getTime() : Date.now() - DEFAULT_LOOKBACK_MS
    const fallbackSymbols = COMMON_BASE_ASSETS.map((base) => `${base}USDT`)
    const recentTrades = await this.fetchRecentFuturesTrades(apiKey, apiSecret, fallbackSymbols)
    let primaryTrades = this.deduplicateFuturesTrades(recentTrades)

    if (primaryTrades.length === 0) {
      const historicalTrades = await this.fetchHistoricalFuturesTrades(
        apiKey,
        apiSecret,
        fallbackSymbols,
        startTime
      )
      primaryTrades = this.deduplicateFuturesTrades(historicalTrades)
    }

    const incomeRecords = await this.fetchFuturesIncome(apiKey, apiSecret, startTime)

    if (primaryTrades.length === 0) {
      const incomeSymbols = Array.from(
        new Set(
          incomeRecords
            .map((record) => String(record.symbol ?? '').trim().toUpperCase())
            .filter((symbol) => symbol.length > 0)
        )
      )

      if (incomeSymbols.length > 0) {
        const recoveredRecentTrades = await this.fetchRecentFuturesTrades(apiKey, apiSecret, incomeSymbols)
        primaryTrades = this.deduplicateFuturesTrades(recoveredRecentTrades)
      }
    }

    const supplementalIncomeTrades = this.normalizeSupplementalFuturesIncome(incomeRecords, primaryTrades)

    if (primaryTrades.length > 0) {
      return this.deduplicateFuturesTrades([...primaryTrades, ...supplementalIncomeTrades])
    }

    return this.deduplicateFuturesTrades(supplementalIncomeTrades)
  }

  private async fetchRecentFuturesTrades(
    apiKey: string,
    apiSecret: string,
    symbols: string[]
  ): Promise<ExchangeAdapterTrade[]> {
    const uniqueSymbols = Array.from(
      new Set(symbols.map((symbol) => symbol.trim().toUpperCase()).filter((symbol) => symbol.length > 0))
    )

    const allTrades: ExchangeAdapterTrade[] = []

    for (const symbol of uniqueSymbols) {
      await sleep(80)
      const trades = await this.fetchRecentFuturesTradesForSymbol(apiKey, apiSecret, symbol)
      allTrades.push(...trades)
    }

    return allTrades
  }

  private async fetchHistoricalFuturesTrades(
    apiKey: string,
    apiSecret: string,
    symbols: string[],
    startTime: number
  ): Promise<ExchangeAdapterTrade[]> {
    const uniqueSymbols = Array.from(
      new Set(symbols.map((symbol) => symbol.trim().toUpperCase()).filter((symbol) => symbol.length > 0))
    )

    const allTrades: ExchangeAdapterTrade[] = []

    for (const symbol of uniqueSymbols) {
      await sleep(80)
      const trades = await this.fetchFuturesTradesForSymbol(apiKey, apiSecret, symbol, startTime)
      allTrades.push(...trades)
    }

    return allTrades
  }

  private deduplicateFuturesTrades(trades: ExchangeAdapterTrade[]): ExchangeAdapterTrade[] {
    const dedup = new Set<string>()

    return trades.filter((trade) => {
      const key = `${trade.symbol}:${trade.external_trade_id}`
      if (dedup.has(key)) return false
      dedup.add(key)
      return true
    })
  }

  private extractFuturesUserTradeIds(trades: ExchangeAdapterTrade[]): Set<string> {
    const tradeIds = new Set<string>()

    for (const trade of trades) {
      const raw = trade.raw_data as Record<string, unknown> | null
      const rawId = raw ? raw.id : undefined

      if (typeof rawId === 'number' || typeof rawId === 'string') {
        const normalizedId = String(rawId).trim()
        if (normalizedId.length > 0) {
          tradeIds.add(normalizedId)
        }
        continue
      }

      const idFromExternal = /^futures_(.+)$/.exec(trade.external_trade_id)?.[1]
      if (idFromExternal && idFromExternal.length > 0) {
        tradeIds.add(idFromExternal)
      }
    }

    return tradeIds
  }

  private normalizeSupplementalFuturesIncome(
    incomeRecords: BinanceFuturesIncome[],
    primaryTrades: ExchangeAdapterTrade[]
  ): ExchangeAdapterTrade[] {
    if (incomeRecords.length === 0) return []

    const userTradeIds = this.extractFuturesUserTradeIds(primaryTrades)

    return incomeRecords
      .filter((record) => {
        const incomeType = String(record.incomeType ?? '').toUpperCase()
        const tradeId = String(record.tradeId ?? '').trim()

        if (incomeType === 'REALIZED_PNL' && tradeId.length > 0 && userTradeIds.has(tradeId)) {
          return false
        }

        return true
      })
      .flatMap((record) => {
        const normalized = this.normalizeFuturesIncome(record)
        return normalized ? [normalized] : []
      })
  }

  private async fetchFuturesIncome(
    apiKey: string,
    apiSecret: string,
    startTime: number
  ): Promise<BinanceFuturesIncome[]> {
    const allRecords: BinanceFuturesIncome[] = []
    const dedup = new Set<string>()
    const now = this.scanEndMs
    let currentStart = Math.max(startTime, now - FUTURES_USER_TRADES_LOOKBACK_MS)

    while (currentStart < now) {
      const endTime = Math.min(currentStart + FUTURES_INCOME_CHUNK_MS, now)
      let maxSeenTime = currentStart

      for (const incomeType of FUTURES_INCOME_TYPES) {
        let pageStart = currentStart

        while (pageStart <= endTime) {
          const timestamp = Date.now()
          const params = new URLSearchParams({
            incomeType,
            startTime: String(pageStart),
            endTime: String(endTime),
            limit: '1000',
            timestamp: String(timestamp),
          })
          params.append('signature', sign(params.toString(), apiSecret))

          const response = await this.fetchWithRetry(`${FUTURES_URL}/fapi/v1/income?${params}`, {
            headers: { 'X-MBX-APIKEY': apiKey },
          })

          if (!response.ok) {
            throwOnServerPage(response)
            pageStart = endTime + 1
            continue
          }

          const data = (await response.json()) as BinanceFuturesIncome[]
          if (!Array.isArray(data) || data.length === 0) {
            pageStart = endTime + 1
            continue
          }

          let pageMaxTime = pageStart
          for (const item of data) {
            pageMaxTime = Math.max(pageMaxTime, item.time)
            const id = `${item.incomeType}:${item.tranId}:${item.time}:${item.symbol}`
            if (!dedup.has(id)) {
              dedup.add(id)
              allRecords.push(item)
            }
          }

          maxSeenTime = Math.max(maxSeenTime, pageMaxTime)

          if (data.length < 1000 || pageMaxTime + 1 <= pageStart) {
            pageStart = endTime + 1
          } else {
            pageStart = pageMaxTime + 1
          }

          await sleep(80)
        }
      }

      currentStart = Math.max(endTime + 1, maxSeenTime + 1)
      await sleep(80)
    }

    allRecords.sort((a, b) => a.time - b.time)
    return allRecords
  }

  private async fetchFuturesTradesForSymbol(
    apiKey: string,
    apiSecret: string,
    symbol: string,
    startTime: number
  ): Promise<ExchangeAdapterTrade[]> {
    const allTrades: BinanceFuturesTrade[] = []
    const now = this.scanEndMs
    let windowStart = Math.max(startTime, now - FUTURES_USER_TRADES_LOOKBACK_MS)

    while (windowStart < now) {
      const windowEnd = Math.min(windowStart + FUTURES_USER_TRADES_WINDOW_MS - 1, now)
      const timestamp = Date.now()
      const params = new URLSearchParams({
        symbol,
        limit: '1000',
        startTime: String(windowStart),
        endTime: String(windowEnd),
        timestamp: String(timestamp),
      })
      params.append('signature', sign(params.toString(), apiSecret))

      const response = await this.fetchWithRetry(`${FUTURES_URL}/fapi/v1/userTrades?${params}`, {
        headers: { 'X-MBX-APIKEY': apiKey },
      })

      if (!response.ok) {
        throwOnServerPage(response)
        const err = (await response.json()) as { code?: number }
        if (err?.code === -1121) return []
        if (err?.code === -4061) return []
        console.error(`[BinanceAdapter] fetchFuturesTradesForSymbol failed for ${symbol}:`, err)
        windowStart = windowEnd + 1
        continue
      }

      const data = (await response.json()) as BinanceFuturesTrade[]
      if (Array.isArray(data) && data.length > 0) {
        allTrades.push(...data)
      }

      windowStart = windowEnd + 1
      await sleep(80)
    }

    const trades: ExchangeAdapterTrade[] = []
    for (const row of allTrades.sort((a, b) => a.time - b.time)) {
      const normalized = this.normalizeFuturesTrade(row)
      if (normalized) trades.push(normalized)
    }
    return trades
  }

  private async fetchRecentFuturesTradesForSymbol(
    apiKey: string,
    apiSecret: string,
    symbol: string
  ): Promise<ExchangeAdapterTrade[]> {
    const timestamp = Date.now()
    const params = new URLSearchParams({
      symbol,
      limit: '1000',
      timestamp: String(timestamp),
    })
    params.append('signature', sign(params.toString(), apiSecret))

    const response = await this.fetchWithRetry(`${FUTURES_URL}/fapi/v1/userTrades?${params}`, {
      headers: { 'X-MBX-APIKEY': apiKey },
    })

    if (!response.ok) {
      throwOnServerPage(response)
      const err = (await response.json()) as { code?: number }
      if (err?.code === -1121) return []
      if (err?.code === -4061) return []
      return []
    }

    const data = (await response.json()) as BinanceFuturesTrade[]
    if (!Array.isArray(data) || data.length === 0) {
      return []
    }

    const trades: ExchangeAdapterTrade[] = []
    for (const row of data.sort((a, b) => a.time - b.time)) {
      const normalized = this.normalizeFuturesTrade(row)
      if (normalized) trades.push(normalized)
    }
    return trades
  }

  private normalizeSpotTrade(t: BinanceSpotTrade): ExchangeAdapterTrade | null {
    const tradedAt = epochMillisToIso(t.time)
    if (!tradedAt) return this.rejections.reject('INVALID_TIMESTAMP')
    const quantity = requiredDecimal(t.qty, this.rejections)
    if (!quantity) return null
    const price = requiredDecimal(t.price, this.rejections)
    if (!price) return null
    const fee = requiredDecimal(t.commission, this.rejections)
    if (!fee) return null
    const id = String(t.id ?? '').trim()
    if (!id) return this.rejections.reject('MISSING_ID')
    return {
      external_trade_id: `spot_${id}`,
      symbol: t.symbol,
      side: t.isBuyer ? 'buy' : 'sell',
      quantity,
      price,
      fee,
      fee_currency: t.commissionAsset,
      realized_pnl: null,
      trade_type: 'spot',
      traded_at: tradedAt,
      raw_data: t as unknown as Record<string, unknown>,
    }
  }

  private normalizeFuturesTrade(t: BinanceFuturesTrade): ExchangeAdapterTrade | null {
    const tradedAt = epochMillisToIso(t.time)
    if (!tradedAt) return this.rejections.reject('INVALID_TIMESTAMP')
    const quantity = requiredDecimal(t.qty, this.rejections)
    if (!quantity) return null
    const price = requiredDecimal(t.price, this.rejections)
    if (!price) return null
    const fee = requiredDecimal(t.commission, this.rejections)
    if (!fee) return null
    const realizedPnl = optionalDecimal(t.realizedPnl, this.rejections)
    if (realizedPnl === undefined) return null
    const id = String(t.id ?? '').trim()
    if (!id) return this.rejections.reject('MISSING_ID')
    const side = t.side.toLowerCase() === 'sell' ? 'sell' : 'buy'
    return {
      external_trade_id: `futures_${id}`,
      symbol: t.symbol,
      side,
      quantity,
      price,
      fee,
      fee_currency: t.commissionAsset,
      realized_pnl: realizedPnl,
      trade_type: 'futures',
      traded_at: tradedAt,
      raw_data: t as unknown as Record<string, unknown>,
    }
  }

  private normalizeFuturesIncome(r: BinanceFuturesIncome): ExchangeAdapterTrade | null {
    const tradedAt = epochMillisToIso(r.time)
    if (!tradedAt) return this.rejections.reject('INVALID_TIMESTAMP')
    const incomeValue = requiredDecimal(r.income, this.rejections)
    if (!incomeValue) return null
    const incomeType = String(r.incomeType ?? '').trim().toLowerCase() || 'unknown'
    const tradeId = String(r.tradeId ?? '').trim() || 'na'
    const tranId = String(r.tranId ?? '').trim()
    if (!tranId) return this.rejections.reject('MISSING_ID')
    const negative = incomeValue.startsWith('-') && !/^-0(\.0+)?$/.test(incomeValue)
    return {
      external_trade_id: `futures_income_${incomeType}_${tranId}_${r.time}_${tradeId}`,
      symbol: r.symbol,
      side: negative ? 'buy' : 'sell',
      quantity: '0',
      price: '0',
      fee: '0',
      fee_currency: r.asset,
      realized_pnl: incomeValue,
      funding_fee: r.incomeType === 'FUNDING_FEE' ? incomeValue : '0',
      income_type: r.incomeType,
      trade_type: 'futures',
      traded_at: tradedAt,
      raw_data: r as unknown as Record<string, unknown>,
    }
  }

  async fetchOpenPositions(credentials: ExchangeCredentials): Promise<UnrealizedPosition[]> {
    return this.withProxy(credentials, async () => {
      const timestamp = Date.now()
      const queryString = `timestamp=${timestamp}`
      const signature = sign(queryString, credentials.apiSecret)

      const response = await this.fetchWithRetry(
        `${FUTURES_URL}/fapi/v2/positionRisk?${queryString}&signature=${signature}`,
        { headers: { 'X-MBX-APIKEY': credentials.apiKey } }
      )

      if (!response.ok) return []

      const data = (await response.json()) as BinancePositionRisk[]
      return data
        .filter((position) => Math.abs(parseFloat(position.positionAmt)) > 0)
        .map((position) => ({
          symbol: position.symbol,
          side: parseFloat(position.positionAmt) >= 0 ? 'long' : 'short',
          size: Math.abs(parseFloat(position.positionAmt)),
          entryPrice: parseFloat(position.entryPrice),
          markPrice: parseFloat(position.markPrice),
          unrealizedPnl: parseFloat(position.unRealizedProfit),
          leverage: parseFloat(position.leverage),
          tradeType: 'futures',
        }))
    })
  }

  async fetchBalances(credentials: ExchangeCredentials): Promise<AssetBalance[]> {
    return this.withProxy(credentials, async () => {
      const timestamp = Date.now()
      const queryString = `timestamp=${timestamp}`
      const signature = sign(queryString, credentials.apiSecret)

      const response = await this.fetchWithRetry(
        `${BASE_URL}/api/v3/account?${queryString}&signature=${signature}`,
        { headers: { 'X-MBX-APIKEY': credentials.apiKey } }
      )

      if (!response.ok) return []

      const data = (await response.json()) as { balances: BinanceBalance[] }
      const balances = data.balances
        .map((balance) => {
          const free = parseFloat(balance.free)
          const locked = parseFloat(balance.locked)
          const total = free + locked
          return { asset: balance.asset, free, locked, total }
        })
        .filter((balance) => balance.total > 0)

      const priced = await Promise.all(
        balances.map(async (balance) => {
          const usdPrice = await this.getUsdPrice(balance.asset)
          return {
            asset: balance.asset,
            free: balance.free,
            locked: balance.locked,
            usdValue: balance.total * usdPrice,
          } satisfies AssetBalance
        })
      )

      return priced
    })
  }

  private async getUsdPrice(asset: string): Promise<number> {
    if (STABLE_ASSETS.has(asset)) return 1
    if (asset === 'USD') return 1

    try {
      const symbol = `${asset}USDT`
      const response = await this.fetchWithRetry(`${BASE_URL}/api/v3/ticker/price?symbol=${symbol}`)
      if (!response.ok) return 0
      const data = (await response.json()) as { price?: string }
      return data.price ? parseFloat(data.price) : 0
    } catch {
      return 0
    }
  }
}

type BinanceSpotTrade = {
  id: number
  symbol: string
  price: string
  qty: string
  commission: string
  commissionAsset: string
  time: number
  isBuyer: boolean
}

type BinanceFuturesTrade = {
  id: number
  symbol: string
  side: string
  price: string
  qty: string
  commission: string
  commissionAsset: string
  realizedPnl: string
  time: number
}

type BinanceFuturesIncome = {
  symbol: string
  incomeType: string
  income: string
  asset: string
  info: string
  time: number
  tranId: number
  tradeId: string
}

type BinanceBalance = {
  asset: string
  free: string
  locked: string
}

type BinanceApiRestrictions = {
  enableSpotAndMarginTrading?: boolean
  enableFutures?: boolean
  enableWithdrawals?: boolean
  ipRestrict?: boolean
  canWithdraw?: boolean
  isWithdrawEnabled?: boolean
}

type BinancePositionRisk = {
  symbol: string
  positionAmt: string
  entryPrice: string
  markPrice: string
  unRealizedProfit: string
  leverage: string
}
