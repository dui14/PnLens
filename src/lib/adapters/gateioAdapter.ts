import { HistoryGapTracker, type HistoryGap } from './historyGaps'
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
import { SCAN_LOOKBACK_MS } from '@/lib/scan/scanLimits'
import { fetchExchange } from './httpClient'
import { throwOnServerPage } from './exchangeWindowError'
import {
  TradeRejectCounter,
  VENUE_DECIMAL,
  absDecimal,
  decimalOrZero,
  multiplyDecimals,
  flexibleTimeToIso,
  optionalDecimal,
  requiredDecimal,
  type TradeRejectCounts,
} from './tradeFields'
const REQUEST_TIMEOUT = 10_000
const DEFAULT_LOOKBACK_MS = SCAN_LOOKBACK_MS
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

function textValue(value: unknown): string | undefined {
  if (typeof value === 'string') return value
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return undefined
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

function parseContractSpec(row: GateFuturesContract): GateFuturesContractSpec | null {
  const raw = row.quanto_multiplier ?? row.multiplier
  const multiplierRaw = asNumber(raw)
  const multiplier = Number.isFinite(multiplierRaw) ? Math.abs(multiplierRaw) : 0
  if (multiplier <= 0) return null
  const multiplierText = VENUE_DECIMAL.test(String(raw ?? '')) ? absDecimal(String(raw)) : undefined
  return { multiplier, multiplierText }
}

export class GateioAdapter implements ExchangeAdapter {
  private futuresContractSpecsBySettle = new Map<string, Map<string, GateFuturesContractSpec>>()
  private tradeContractSpecsBySettle = new Map<string, Map<string, GateFuturesContractSpec>>()
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
      const request = () => ({ method: 'GET', headers: this.buildHeaders(credentials, 'GET', requestPath) })
      const response = await fetchWithRetry(`${BASE_URL}${requestPath}`, request)
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
    this.gaps.reset()
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
      const request = () => ({ method: 'GET', headers: this.buildHeaders(credentials, 'GET', requestPath) })
      const response = await fetchWithRetry(`${BASE_URL}${requestPath}`, request)

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
    const request = () => ({ method: 'GET', headers: this.buildHeaders(credentials, 'GET', requestPath) })
    const response = await fetchWithRetry(`${BASE_URL}${requestPath}`, request)

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
        const request = () => ({ method: 'GET', headers: this.buildHeaders(credentials, 'GET', requestPath, queryString) })
        const response = await fetchWithRetry(`${BASE_URL}${requestPath}?${queryString}`, request)

        throwOnServerPage(response)
          if (!response.ok) { this.gaps.record('spot', windowStartSec * 1000, windowEndSec * 1000); break }
        const data = (await response.json()) as unknown
        if (!Array.isArray(data)) { this.gaps.record('spot', windowStartSec * 1000, windowEndSec * 1000); break }
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
          const request = () => ({ method: 'GET', headers: this.buildHeaders(credentials, 'GET', requestPath, queryString) })
          const response = await fetchWithRetry(`${BASE_URL}${requestPath}?${queryString}`, request)

          throwOnServerPage(response)
          if (!response.ok) { this.gaps.record(`futures_${settle}`, windowStartSec * 1000, windowEndSec * 1000); break }
          const data = (await response.json()) as unknown
          if (!Array.isArray(data)) { this.gaps.record(`futures_${settle}`, windowStartSec * 1000, windowEndSec * 1000); break }
          const pageTrades = data as GateFuturesTrade[]
          if (pageTrades.length === 0) break

          const contractSpecs = await this.loadTradeContractSpecs(settle, pageTrades)
          const resolvable = pageTrades.filter((trade) => contractSpecs.get(String(trade.contract ?? '').toUpperCase())?.multiplierText)
          if (resolvable.length < pageTrades.length) {
            this.gaps.record(`futures_${settle}`, windowStartSec * 1000, windowEndSec * 1000)
          }

          allTrades.push(
            ...resolvable.flatMap((trade) =>
              this.accepted(this.normalizeFuturesTrade(trade, settle, contractSpecs))
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
          const request = () => ({ method: 'GET', headers: this.buildHeaders(credentials, 'GET', requestPath, queryString) })
          const response = await fetchWithRetry(`${BASE_URL}${requestPath}?${queryString}`, request)

          throwOnServerPage(response)
          if (!response.ok) { this.gaps.record(`position_close_${settle}`, windowStartSec * 1000, windowEndSec * 1000); break }
          const data = (await response.json()) as unknown
          if (!Array.isArray(data)) { this.gaps.record(`position_close_${settle}`, windowStartSec * 1000, windowEndSec * 1000); break }
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
    const explicit = textValue(explicitId)?.trim()
    if (explicit) return explicit
    const order = textValue(orderId)?.trim()
    if (order && (typeof timeValue === 'string' || typeof timeValue === 'number')) {
      return `${prefix}_${order}_${timeValue}`
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

  private normalizeFuturesTrade(
    trade: GateFuturesTrade,
    settle: string,
    contractSpecs: Map<string, GateFuturesContractSpec>
  ): ExchangeAdapterTrade | null {
    const tradedAt = toIsoFromGateTimestamp(trade.create_time_ms ?? trade.create_time)
    if (!tradedAt) return this.rejections.reject('INVALID_TIMESTAMP')
    const externalTradeId = this.stableTradeId(
      trade.trade_id ?? trade.id,
      'futures',
      trade.order_id,
      trade.create_time_ms ?? trade.create_time
    )
    if (!externalTradeId) return this.rejections.reject('MISSING_ID')
    const contracts = requiredDecimal(textValue(trade.size) ?? textValue(trade.qty) ?? null, this.rejections)
    if (!contracts) return null
    const multiplier = contractSpecs.get(String(trade.contract ?? '').toUpperCase())?.multiplierText
    const scaled = multiplier ? multiplyDecimals(contracts, multiplier) : contracts
    if (!scaled) return this.rejections.reject('INVALID_NUMBER')
    const quantity = absDecimal(scaled)
    const price = requiredDecimal(typeof trade.price === 'string' ? trade.price : null, this.rejections)
    if (!price) return null
    const fee = decimalOrZero(textValue(trade.fee), this.rejections)
    if (!fee) return null
    const realizedPnl = optionalDecimal(textValue(trade.pnl), this.rejections)
    if (realizedPnl === undefined) return null
    const sideField = typeof trade.side === 'string' ? trade.side.toLowerCase() : ''
    const sideFromSize: 'buy' | 'sell' = contracts.startsWith('-') && !/^-0(\.0+)?$/.test(contracts) ? 'sell' : 'buy'
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
      const spec = parseContractSpec(row)
      if (contractName && spec) specs.set(contractName, spec)
    }

    this.futuresContractSpecsBySettle.set(settleKey, specs)
    return specs
  }

  private async loadTradeContractSpecs(
    settle: string,
    trades: GateFuturesTrade[]
  ): Promise<Map<string, GateFuturesContractSpec>> {
    const specs = this.tradeContractSpecsBySettle.get(settle) ?? new Map<string, GateFuturesContractSpec>()
    this.tradeContractSpecsBySettle.set(settle, specs)
    const names = new Set(trades.map((trade) => String(trade.contract ?? '').toUpperCase()).filter(Boolean))

    for (const name of names) {
      if (specs.has(name)) continue
      try {
        const response = await fetchWithRetry(`${BASE_URL}/futures/${settle}/contracts/${name}`, { method: 'GET' })
        if (!response.ok) continue
        const data = (await response.json()) as unknown
        const row = (Array.isArray(data) ? data.find((item) => String(item?.name ?? '').toUpperCase() === name) : data) as
          | GateFuturesContract
          | undefined
        const spec = row && typeof row === 'object' ? parseContractSpec(row) : null
        if (spec) specs.set(name, spec)
      } catch {
        continue
      }
    }

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
    const pnl = optionalDecimal(textValue(pnlSource), this.rejections)
    if (pnl === undefined || pnl === null) return null

    const symbol = normalizeSymbol(trade.contract)
    if (!symbol) return null

    const sideField = typeof trade.side === 'string' ? trade.side.toLowerCase() : ''
    const sizeText = textValue(trade.size) ?? ''
    const sideFromSize: 'buy' | 'sell' = sizeText.startsWith('-') && !/^-0(\.0+)?$/.test(sizeText) ? 'sell' : 'buy'
    const side: 'buy' | 'sell' =
      sideField === 'sell' || sideField === 'long'
        ? 'sell'
        : sideField === 'buy' || sideField === 'short'
          ? 'buy'
          : sideFromSize

    const eventTs = trade.close_time_ms ?? trade.time_ms ?? trade.close_time ?? trade.time
    const tradedAt = toIsoFromGateTimestamp(eventTs)
    if (!tradedAt) return this.rejections.reject('INVALID_TIMESTAMP')
    const explicitId = textValue(trade.id)?.trim()
    const orderId = textValue(trade.order_id)?.trim()
    const externalTradeId =
      explicitId ||
      (orderId
        ? `position_close_${orderId}_${String(eventTs)}`
        : `position_close_${symbol}_${sideField}_${String(eventTs)}`)
    const fee = decimalOrZero(textValue(trade.fee ?? trade.pnl_fee), this.rejections)
    if (!fee) return null
    const fundingFee = decimalOrZero(textValue(trade.funding_fee ?? trade.pnl_fund), this.rejections)
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
  id?: string | number
  trade_id?: string | number
  order_id?: string | number
  contract?: string
  side?: string
  size?: string | number
  qty?: string | number
  price?: string
  fee?: string | number
  fee_currency?: string
  settle?: string
  pnl?: string | number
  create_time?: string | number
  create_time_ms?: string
}

type GatePositionClose = {
  id?: string
  order_id?: string | number
  contract?: string
  side?: string
  size?: string | number
  fee?: string | number
  fee_currency?: string
  settle?: string
  pnl?: string | number
  close_pnl?: string | number
  realized_pnl?: string | number
  funding_fee?: string | number
  pnl_fee?: string | number
  pnl_fund?: string | number
  close_time?: string | number
  close_time_ms?: string
  time?: string | number
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
  multiplierText?: string
}
