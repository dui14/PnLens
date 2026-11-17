import { HistoryGapTracker, type HistoryGap } from './historyGaps'
import { keyObjectFromSecret, signAsymmetricKey } from './pemPrivateKey'
import type {
  ExchangeAdapterTrade,
  ExchangeCredentials,
  AssetBalance,
  UnrealizedPosition,
} from '@/lib/types'
import type { ExchangeAdapter } from './exchangeFactory'
import {
  interpretBitgetApiKeyInfo,
  probeFailure,
  readJson,
  type CredentialProbeResult,
} from './credentialValidation'

import { BITGET_BASE_URL as BASE_URL } from './exchangeBases'
import { DAY_MS, EXCHANGE_SCAN_LIMITS, SCAN_LOOKBACK_MS } from '@/lib/scan/scanLimits'
import { fetchExchange } from './httpClient'
import { throwOnServerPage } from './exchangeWindowError'
import {
  TradeRejectCounter,
  addDecimals,
  decimalOrZero,
  optionalDecimal,
  requiredDecimal,
  type TradeRejectCounts,
} from './tradeFields'
const REQUEST_TIMEOUT = 10_000
const DEFAULT_LOOKBACK_MS = SCAN_LOOKBACK_MS
const BITGET_FUTURES_WINDOW_MS = 7 * DAY_MS
const BITGET_HISTORY_LOOKBACK_MS = EXCHANGE_SCAN_LIMITS.bitget.maxLookbackDays * DAY_MS

function parseBitgetCTime(cTime: unknown): string | null {
  if (typeof cTime !== 'string' || !/^\d+$/.test(cTime)) return null
  if (cTime.length === 10) return new Date(Number(cTime) * 1000).toISOString()
  if (cTime.length === 13) return new Date(Number(cTime)).toISOString()
  return null
}

function sign(timestamp: string, method: string, requestPath: string, body: string, secret: string): string {
  const message = `${timestamp}${method.toUpperCase()}${requestPath}${body}`
  return signAsymmetricKey('bitget', message, keyObjectFromSecret(secret))
}

function bitgetAccountInfoBody(body: unknown): unknown {
  if (!body || typeof body !== 'object') return body
  const record = body as Record<string, unknown>
  const data = record.data
  if (!data || typeof data !== 'object' || Array.isArray(data)) return body
  const row = data as Record<string, unknown>
  if (typeof row.permType !== 'string') return body
  const permissions = Array.isArray(row.permissions)
    ? row.permissions.filter((token): token is string => typeof token === 'string')
    : []
  const authorities = [...permissions]
  if (row.permType === 'read-only') authorities.push('readonly')
  if (row.permType === 'read-and-write') authorities.push('trade')
  const ipList = typeof row.ips === 'string'
    ? row.ips.split(',').map((token) => token.trim()).filter((token) => token.length > 0)
    : []
  return {
    ...record,
    data: {
      authorities,
      status: 'normal',
      ipList,
    },
  }
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

type RequestSource = RequestInit | (() => RequestInit)

function resolveRequest(source?: RequestSource): RequestInit | undefined {
  return typeof source === 'function' ? source() : source
}

async function fetchWithRetry(url: string, options?: RequestSource, attempt = 0): Promise<Response> {
  const response = await fetchWithTimeout(url, resolveRequest(options))
  if (response.status === 429 && attempt < 4) {
    const backoff = Math.min(Math.pow(2, attempt) * 1000, 60_000)
    await sleep(backoff + Math.random() * 500)
    return fetchWithRetry(url, options, attempt + 1)
  }
  return response
}

export class BitgetAdapter implements ExchangeAdapter {
  private readonly rejections = new TradeRejectCounter()
  private readonly gaps = new HistoryGapTracker()

  historyGaps(): HistoryGap[] {
    return this.gaps.gaps
  }


  rejectedTradeCounts(): TradeRejectCounts {
    return this.rejections.counts
  }

  private buildHeaders(
    credentials: ExchangeCredentials,
    method: string,
    pathWithQuery: string,
    body = ''
  ): Record<string, string> {
    const timestamp = Date.now().toString()
    const signature = sign(timestamp, method, pathWithQuery, body, credentials.apiSecret)
    return {
      'ACCESS-KEY': credentials.apiKey,
      'ACCESS-SIGN': signature,
      'ACCESS-TIMESTAMP': timestamp,
      'ACCESS-PASSPHRASE': credentials.passphrase ?? '',
      'Content-Type': 'application/json',
    }
  }

  async validateCredentials(credentials: ExchangeCredentials): Promise<CredentialProbeResult> {
    try {
      if (!credentials.passphrase || !credentials.apiSecret.trim()) {
        return probeFailure('INVALID_SECRET_OR_PASSPHRASE')
      }
      const infoPath = '/api/v2/user/apikey-info'
      const infoResponse = await fetchWithRetry(`${BASE_URL}${infoPath}`, () => ({
        headers: this.buildHeaders(credentials, 'GET', infoPath),
      }))
      const infoBody = await readJson(infoResponse)
      const infoRecord = infoBody && typeof infoBody === 'object' ? infoBody as Record<string, unknown> : null
      const infoCode = infoRecord && (typeof infoRecord.code === 'string' || typeof infoRecord.code === 'number')
        ? String(infoRecord.code)
        : ''
      const missingInfo = infoResponse.status === 404 || infoCode === '40404'
      if (!missingInfo) {
        return interpretBitgetApiKeyInfo(infoResponse.status, bitgetAccountInfoBody(infoBody))
      }
      const assetsPath = '/api/v2/spot/account/assets'
      const assetsResponse = await fetchWithRetry(`${BASE_URL}${assetsPath}`, () => ({
        headers: this.buildHeaders(credentials, 'GET', assetsPath),
      }))
      return interpretBitgetApiKeyInfo(assetsResponse.status, await readJson(assetsResponse))
    } catch (error) {
      if (error instanceof Error && error.message === 'UNSUPPORTED_SIGNING_KEY') {
        return probeFailure('INVALID_SECRET_OR_PASSPHRASE')
      }
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
    this.gaps.reset()
    const startTime = since ? since.getTime() : Date.now() - DEFAULT_LOOKBACK_MS
    const [spotTrades, futuresTrades] = await Promise.all([
      this.fetchSpotTrades(credentials, startTime),
      this.fetchFuturesHistory(credentials, startTime),
    ])

    return [...spotTrades, ...futuresTrades]
  }

  private async fetchSpotTrades(
    credentials: ExchangeCredentials,
    startTime: number
  ): Promise<ExchangeAdapterTrade[]> {
    const allSymbolTrades = await this.fetchSpotTradesAllSymbols(credentials, startTime)
    if (allSymbolTrades !== null) {
      return this.deduplicateTrades(allSymbolTrades)
    }

    return this.fetchSpotTradesByKnownSymbols(credentials, startTime)
  }

  private async fetchSpotTradesAllSymbols(
    credentials: ExchangeCredentials,
    startTime: number
  ): Promise<ExchangeAdapterTrade[] | null> {
    const allTrades: ExchangeAdapterTrade[] = []
    const now = this.scanEndMs
    let windowStart = startTime

    while (windowStart <= now) {
      const windowEnd = Math.min(windowStart + BITGET_FUTURES_WINDOW_MS - 1, now)
      let idLessThan = ''

      for (let page = 0; page < 30; page += 1) {
        const query = new URLSearchParams({
          startTime: String(windowStart),
          endTime: String(windowEnd),
          limit: '100',
        })
        if (idLessThan) query.set('idLessThan', idLessThan)

        const path = `/api/v2/spot/trade/fills?${query.toString()}`
        const request = () => ({ headers: this.buildHeaders(credentials, 'GET', path) })
        const response = await fetchWithRetry(`${BASE_URL}${path}`, request)
        throwOnServerPage(response)
        if (!response.ok) return null

        const data = (await response.json()) as {
          code: string
          data?: Array<BitgetSpotFill>
          msg?: string
        }
        if (data.code !== '00000') {
          const message = String(data.msg ?? '').toLowerCase()
          if (message.includes('symbol')) {
            return null
          }
          this.gaps.record('spot', windowStart, windowEnd)
          break
        }

        const list = data.data ?? []
        if (list.length === 0) break

        allTrades.push(...list.flatMap((trade) => this.accepted(this.normalizeSpotTrade(trade))))

        const nextCursor = list[list.length - 1]?.tradeId ?? ''
        if (!nextCursor || list.length < 100) break
        idLessThan = nextCursor
        await sleep(80)
      }

      windowStart = windowEnd + 1
      await sleep(80)
    }

    return allTrades
  }

  private async fetchSpotTradesByKnownSymbols(
    credentials: ExchangeCredentials,
    startTime: number
  ): Promise<ExchangeAdapterTrade[]> {
    const allTrades: ExchangeAdapterTrade[] = []
    const now = this.scanEndMs
    const symbols = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'DOGEUSDT']

    for (const symbol of symbols) {
      let windowStart = startTime

      while (windowStart <= now) {
        const windowEnd = Math.min(windowStart + BITGET_FUTURES_WINDOW_MS - 1, now)
        let idLessThan = ''

        for (let page = 0; page < 30; page += 1) {
          const query = new URLSearchParams({
            symbol,
            startTime: String(windowStart),
            endTime: String(windowEnd),
            limit: '100',
          })
          if (idLessThan) query.set('idLessThan', idLessThan)

          const path = `/api/v2/spot/trade/fills?${query.toString()}`
          const request = () => ({ headers: this.buildHeaders(credentials, 'GET', path) })
          const response = await fetchWithRetry(`${BASE_URL}${path}`, request)
          throwOnServerPage(response)
          if (!response.ok) { this.gaps.record('spot', windowStart, windowEnd); break }

          const data = (await response.json()) as {
            code: string
            data?: Array<BitgetSpotFill>
            msg?: string
          }
          if (data.code !== '00000') {
            this.gaps.record('spot', windowStart, windowEnd)
            break
          }

          const list = data.data ?? []
          if (list.length === 0) break

          allTrades.push(...list.flatMap((trade) => this.accepted(this.normalizeSpotTrade(trade))))

          const nextCursor = list[list.length - 1]?.tradeId ?? ''
          if (!nextCursor || list.length < 100) break
          idLessThan = nextCursor
          await sleep(80)
        }

        windowStart = windowEnd + 1
        await sleep(80)
      }

      await sleep(80)
    }

    return this.deduplicateTrades(allTrades)
  }

  private async fetchFuturesHistory(
    credentials: ExchangeCredentials,
    startTime: number
  ): Promise<ExchangeAdapterTrade[]> {
    const productTypes = ['USDT-FUTURES', 'COIN-FUTURES', 'USDC-FUTURES']
    const recentTrades = await this.fetchRecentFuturesHistory(credentials, productTypes)

    const allTrades: ExchangeAdapterTrade[] = []
    const now = this.scanEndMs
    const historyStartTime = Math.max(startTime, now - BITGET_HISTORY_LOOKBACK_MS)

    for (const productType of productTypes) {
      let windowStart = historyStartTime

      while (windowStart <= now) {
        const windowEnd = Math.min(windowStart + BITGET_FUTURES_WINDOW_MS - 1, now)
        let idLessThan = ''

        for (let page = 0; page < 30; page += 1) {
          const query = new URLSearchParams({
            productType,
            startTime: String(windowStart),
            endTime: String(windowEnd),
            limit: '100',
          })
          if (idLessThan) query.set('idLessThan', idLessThan)

          const path = `/api/v2/mix/order/fill-history?${query.toString()}`
          const request = () => ({ headers: this.buildHeaders(credentials, 'GET', path) })
          const response = await fetchWithRetry(`${BASE_URL}${path}`, request)
          throwOnServerPage(response)
          if (!response.ok) { this.gaps.record(productType, windowStart, windowEnd); break }

          const data = (await response.json()) as {
            code: string
            data?: {
              fillList?: Array<BitgetFuturesFill> | null
              endId?: string | null
            }
          }
          if (data.code !== '00000') { this.gaps.record(productType, windowStart, windowEnd); break }

          const list = data.data?.fillList ?? []
          if (list.length === 0) break

          allTrades.push(...list.flatMap((trade) => this.accepted(this.normalizeFuturesTrade(trade))))

          const nextCursor = data.data?.endId ?? ''
          if (!nextCursor || list.length < 100) break
          idLessThan = nextCursor
          await sleep(80)
        }

        windowStart = windowEnd + 1
        await sleep(80)
      }
      await sleep(80)
    }

    const deduplicatedTrades = this.deduplicateFuturesTrades([...recentTrades, ...allTrades])
    const hasRealizedPnl = deduplicatedTrades.some((trade) => trade.realized_pnl !== null)
    if (deduplicatedTrades.length > 0 && hasRealizedPnl) {
      return deduplicatedTrades
    }

    const fallbackPositionTrades = await this.fetchPositionHistoryFallback(credentials, startTime)
    return this.deduplicateFuturesTrades([...deduplicatedTrades, ...fallbackPositionTrades])
  }

  private async fetchRecentFuturesHistory(
    credentials: ExchangeCredentials,
    productTypes: string[]
  ): Promise<ExchangeAdapterTrade[]> {
    const allTrades: ExchangeAdapterTrade[] = []

    for (const productType of productTypes) {
      let idLessThan = ''

      for (let page = 0; page < 30; page += 1) {
        const query = new URLSearchParams({
          productType,
          limit: '100',
        })
        if (idLessThan) query.set('idLessThan', idLessThan)

        const path = `/api/v2/mix/order/fill-history?${query.toString()}`
        const request = () => ({ headers: this.buildHeaders(credentials, 'GET', path) })
        const response = await fetchWithRetry(`${BASE_URL}${path}`, request)
        throwOnServerPage(response)
          if (!response.ok) break

        const data = (await response.json()) as {
          code: string
          data?: {
            fillList?: Array<BitgetFuturesFill> | null
            endId?: string | null
          }
        }

        if (data.code !== '00000') break

        const list = data.data?.fillList ?? []
        if (list.length === 0) break

        allTrades.push(...list.flatMap((trade) => this.accepted(this.normalizeFuturesTrade(trade))))

        const nextCursor = data.data?.endId ?? ''
        if (!nextCursor || list.length < 100) break
        idLessThan = nextCursor
        await sleep(80)
      }

      await sleep(80)
    }

    return allTrades
  }

  private async fetchPositionHistoryFallback(
    credentials: ExchangeCredentials,
    startTime: number
  ): Promise<ExchangeAdapterTrade[]> {
    const allTrades: ExchangeAdapterTrade[] = []
    const now = this.scanEndMs
    const historyStartTime = Math.max(startTime, now - BITGET_HISTORY_LOOKBACK_MS)
    let lastEndId = ''

    for (let page = 0; page < 30; page += 1) {
      const query = new URLSearchParams({
        startTime: String(historyStartTime),
        endTime: String(now),
        pageSize: '100',
      })
      if (lastEndId) query.set('lastEndId', lastEndId)

      const path = `/api/v2/mix/position/history-position?${query.toString()}`
      const request = () => ({ headers: this.buildHeaders(credentials, 'GET', path) })
      const response = await fetchWithRetry(`${BASE_URL}${path}`, request)
      throwOnServerPage(response)
          if (!response.ok) { this.gaps.record('position_history', historyStartTime, now); break }

      const data = (await response.json()) as {
        code: string
        data?: BitgetPositionHistoryData
      }

      if (data.code !== '00000') { this.gaps.record('position_history', historyStartTime, now); break }

      const rows = this.extractPositionHistoryRows(data.data ?? null)
      if (rows.length === 0) break

      for (const row of rows) {
        const normalized = this.normalizePositionHistoryTrade(row)
        if (normalized) {
          allTrades.push(normalized)
        }
      }

      const nextCursor = this.extractPositionHistoryCursor(data.data ?? null)
      if (!nextCursor || rows.length < 100) break
      lastEndId = nextCursor
      await sleep(80)
    }

    return allTrades
  }

  private extractPositionHistoryRows(data: BitgetPositionHistoryData): BitgetHistoryPosition[] {
    if (Array.isArray(data)) return data
    if (data && Array.isArray(data.list)) return data.list
    return []
  }

  private extractPositionHistoryCursor(data: BitgetPositionHistoryData): string {
    if (!data || Array.isArray(data)) return ''
    if (typeof data.lastEndId === 'string' && data.lastEndId) return data.lastEndId
    if (typeof data.endId === 'string' && data.endId) return data.endId
    return ''
  }

  private accepted(trade: ExchangeAdapterTrade | null): ExchangeAdapterTrade[] {
    return trade ? [trade] : []
  }

  private normalizePositionHistoryTrade(position: BitgetHistoryPosition): ExchangeAdapterTrade | null {
    const symbol = (position.symbol ?? '').replace(/_/g, '')
    if (!symbol) return null

    const openFee = decimalOrZero(position.openFee, this.rejections)
    if (!openFee) return null
    const closeFee = decimalOrZero(position.closeFee, this.rejections)
    if (!closeFee) return null
    const fee = addDecimals(openFee, closeFee)
    if (!fee) return this.rejections.reject('INVALID_NUMBER')
    const netProfit = optionalDecimal(position.netProfit, this.rejections)
    if (netProfit === undefined) return null
    const fallbackPnl = netProfit === null ? optionalDecimal(position.pnl, this.rejections) : netProfit
    if (fallbackPnl === undefined || fallbackPnl === null) return null
    const fundingFee = decimalOrZero(position.totalFunding, this.rejections)
    if (!fundingFee) return null
    const side: 'buy' | 'sell' = (position.holdSide ?? '').toLowerCase() === 'short' ? 'buy' : 'sell'
    const rawTime = position.uTime ?? position.utime ?? position.cTime ?? position.ctime
    const tradedAt = parseBitgetCTime(rawTime)
    if (!tradedAt) return this.rejections.reject('INVALID_TIMESTAMP')

    const tradeIdParts = [
      position.positionId ?? position.trackingNo ?? '',
      position.symbol ?? '',
      rawTime ?? '',
    ].filter((part) => part.length > 0)
    if (tradeIdParts.length === 0) return this.rejections.reject('MISSING_ID')

    return {
      external_trade_id: tradeIdParts.join(':'),
      symbol,
      side,
      quantity: '0',
      price: '0',
      fee,
      fee_currency: position.marginCoin ?? 'USDT',
      realized_pnl: fallbackPnl,
      funding_fee: fundingFee,
      income_type: 'history_position',
      trade_type: 'futures',
      traded_at: tradedAt,
      raw_data: position as unknown as Record<string, unknown>,
    }
  }

  private deduplicateFuturesTrades(trades: ExchangeAdapterTrade[]): ExchangeAdapterTrade[] {
    return this.deduplicateTrades(trades)
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

  async fetchOpenPositions(credentials: ExchangeCredentials): Promise<UnrealizedPosition[]> {
    const query = new URLSearchParams({ productType: 'umcbl' })
    const path = `/api/mix/v1/position/allPosition-v2?${query.toString()}`
    const request = () => ({ headers: this.buildHeaders(credentials, 'GET', path) })
    const response = await fetchWithRetry(`${BASE_URL}${path}`, request)

    if (!response.ok) return []

    const data = (await response.json()) as { code: string; data?: BitgetPosition[] }
    if (data.code !== '00000') return []

    return (data.data ?? [])
      .filter((position) => Math.abs(parseFloat(position.total ?? '0')) > 0)
      .map((position) => ({
        symbol: (position.symbol ?? '').replace(/_/g, ''),
        side: (position.holdSide ?? '').toLowerCase() === 'short' ? 'short' : 'long',
        size: Math.abs(parseFloat(position.total ?? '0')),
        entryPrice: parseFloat(position.averageOpenPrice ?? '0'),
        markPrice: parseFloat(position.markPrice ?? '0'),
        unrealizedPnl: parseFloat(position.unrealizedPL ?? '0'),
        leverage: parseFloat(position.leverage ?? '0') || 1,
        tradeType: 'futures',
      }))
  }

  async fetchBalances(credentials: ExchangeCredentials): Promise<AssetBalance[]> {
    const spotPath = '/api/v2/spot/account/assets'
    const spotRequest = () => ({ headers: this.buildHeaders(credentials, 'GET', spotPath) })
    const spotResponse = await fetchWithRetry(`${BASE_URL}${spotPath}`, spotRequest)

    if (!spotResponse.ok) return []

    const spotData = (await spotResponse.json()) as {
      code: string
      data?: BitgetBalance[] | { list?: BitgetBalance[] | null } | null
    }
    if (spotData.code !== '00000') return []

    const rows = Array.isArray(spotData.data)
      ? spotData.data
      : Array.isArray(spotData.data?.list)
        ? spotData.data.list
        : []

    const balances: AssetBalance[] = []
    for (const balance of rows) {
      const free = parseFloat(balance.available ?? balance.free ?? '0')
      const locked = parseFloat(balance.frozen ?? balance.locked ?? balance.lock ?? '0')
      const total = free + locked
      if (total <= 0) continue
      const asset = balance.coinName ?? balance.coin ?? ''
      if (!asset) continue
      const price = await this.getUsdPrice(asset)
      balances.push({
        asset,
        free,
        locked,
        usdValue: total * price,
      })
    }

    return balances
  }

  private normalizeSpotTrade(trade: BitgetSpotFill): ExchangeAdapterTrade | null {
    const tradedAt = parseBitgetCTime(trade.cTime)
    if (!tradedAt) return this.rejections.reject('INVALID_TIMESTAMP')
    const externalTradeId = String(trade.tradeId ?? '').trim()
    if (!externalTradeId) return this.rejections.reject('MISSING_ID')
    const quantity = requiredDecimal(trade.size, this.rejections)
    if (!quantity) return null
    const price = requiredDecimal(trade.priceAvg, this.rejections)
    if (!price) return null
    const fee = decimalOrZero(trade.feeDetail?.totalFee, this.rejections)
    if (!fee) return null
    const side = (trade.side ?? '').toLowerCase() === 'sell' ? 'sell' : 'buy'
    return {
      external_trade_id: externalTradeId,
      symbol: (trade.symbol ?? '').replace(/_/g, ''),
      side,
      quantity,
      price,
      fee,
      fee_currency: trade.feeDetail?.feeCoin ?? 'USDT',
      realized_pnl: null,
      funding_fee: '0',
      income_type: null,
      trade_type: 'spot',
      traded_at: tradedAt,
      raw_data: trade as unknown as Record<string, unknown>,
    }
  }

  private normalizeFuturesTrade(trade: BitgetFuturesFill): ExchangeAdapterTrade | null {
    const tradedAt = parseBitgetCTime(trade.cTime)
    if (!tradedAt) return this.rejections.reject('INVALID_TIMESTAMP')
    const externalTradeId = String(trade.tradeId ?? trade.orderId ?? '').trim()
    if (!externalTradeId) return this.rejections.reject('MISSING_ID')
    const fee = this.futuresFillFee(trade)
    if (!fee) return null
    const pnl = optionalDecimal(trade.profit ?? trade.pnl, this.rejections)
    if (pnl === undefined) return null
    const rawQuantity =
      trade.size ?? trade.baseVolume ?? trade.fillQty ?? trade.fillSz ?? trade.qty
    const rawPrice = trade.price ?? trade.priceAvg ?? trade.fillPrice ?? trade.avgPrice
    const quantity = requiredDecimal(rawQuantity, this.rejections)
    if (!quantity) return null
    const price = requiredDecimal(rawPrice, this.rejections)
    if (!price) return null
    const rawSide = trade.side ?? trade.tradeSide ?? 'buy'

    return {
      external_trade_id: externalTradeId,
      symbol: (trade.symbol ?? '').replace(/_/g, ''),
      side: rawSide.toLowerCase() === 'sell' ? 'sell' : 'buy',
      quantity,
      price,
      fee,
      fee_currency: trade.feeCoin ?? trade.feeDetail?.[0]?.feeCoin ?? trade.marginCoin ?? 'USDT',
      realized_pnl: pnl,
      funding_fee: '0',
      income_type: trade.tradeScope ?? 'fill_history',
      trade_type: 'futures',
      traded_at: tradedAt,
      raw_data: trade as unknown as Record<string, unknown>,
    }
  }

  private futuresFillFee(trade: BitgetFuturesFill): string | null {
    if (!Array.isArray(trade.feeDetail)) return decimalOrZero(trade.fee, this.rejections)
    let total = '0'
    for (const detail of trade.feeDetail) {
      const part = decimalOrZero(detail?.totalFee, this.rejections)
      if (!part) return null
      const sum = addDecimals(total, part)
      if (!sum) return this.rejections.reject('INVALID_NUMBER')
      total = sum
    }
    return total
  }

  private async getUsdPrice(asset: string): Promise<number> {
    if (asset === 'USDT' || asset === 'USDC' || asset === 'USD') return 1

    try {
      const query = new URLSearchParams({ symbol: `${asset}USDT` })
      const path = `/api/v2/spot/market/tickers?${query.toString()}`
      const response = await fetchWithRetry(`${BASE_URL}${path}`)
      if (!response.ok) return 0
      const data = (await response.json()) as {
        code: string
        data?: BitgetTicker[] | { list?: BitgetTicker[] | null } | BitgetTicker | null
      }
      if (data.code !== '00000') return 0

      const tickerData = data.data
      let ticker: BitgetTicker | undefined

      if (Array.isArray(tickerData)) {
        ticker = tickerData[0]
      } else if (tickerData && typeof tickerData === 'object' && 'list' in tickerData) {
        const list = tickerData.list
        ticker = Array.isArray(list) ? list[0] : undefined
      } else if (tickerData && typeof tickerData === 'object') {
        ticker = tickerData as BitgetTicker
      }

      const rawPrice = ticker?.lastPr ?? ticker?.closePr ?? ticker?.close
      return rawPrice ? parseFloat(rawPrice) : 0
    } catch {
      return 0
    }
  }
}

type BitgetSpotFill = {
  tradeId: string
  symbol: string
  side: string
  size: string
  priceAvg: string
  feeDetail?: {
    feeCoin?: string
    totalFee?: string
  }
  cTime: string
}

type BitgetFuturesFill = {
  tradeId?: string
  orderId?: string
  symbol?: string
  side?: string
  tradeSide?: string
  size?: string
  qty?: string
  fillQty?: string
  fillSz?: string
  baseVolume?: string
  price?: string
  priceAvg?: string
  fillPrice?: string
  avgPrice?: string
  fee?: string
  feeCoin?: string
  marginCoin?: string
  pnl?: string
  profit?: string
  feeDetail?: Array<{ feeCoin?: string; totalFee?: string }>
  tradeScope?: string
  cTime?: string
}

type BitgetPositionHistoryData =
  | BitgetHistoryPosition[]
  | {
      list?: BitgetHistoryPosition[] | null
      endId?: string | null
      lastEndId?: string | null
    }
  | null

type BitgetHistoryPosition = {
  positionId?: string
  trackingNo?: string
  symbol?: string
  holdSide?: string
  closeTotalPos?: string
  total?: string
  openAvgPrice?: string
  closeAvgPrice?: string
  pnl?: string
  netProfit?: string
  openFee?: string
  closeFee?: string
  totalFunding?: string
  marginCoin?: string
  uTime?: string
  utime?: string
  cTime?: string
  ctime?: string
}

type BitgetBalance = {
  coinName?: string
  coin?: string
  available?: string
  free?: string
  frozen?: string
  locked?: string
  lock?: string
}

type BitgetTicker = {
  lastPr?: string
  closePr?: string
  close?: string
}

type BitgetPosition = {
  symbol: string
  holdSide: string
  total: string
  averageOpenPrice: string
  markPrice: string
  unrealizedPL: string
  leverage: string
}
