import type { DemoTrade } from '@/lib/types'
import {
  DEMO_CHART_HIGH_PRICE,
  DEMO_CHART_INTERVAL_SECONDS,
  DEMO_CHART_PRICE_DECIMALS_HIGH,
  DEMO_CHART_PRICE_DECIMALS_MID,
  DEMO_PRICE_MAX_DECIMALS,
  DEMO_PRICE_SIGNIFICANT_DIGITS,
  DEMO_TV_EXCHANGE_PREFIX,
  DEMO_TV_FUTURES_SUFFIX,
  type DemoMarket,
  type DemoSizeMode,
  type DemoChartDisplayKey,
  type DemoChartInterval,
} from '@/lib/config/demoTrading'
import {
  calculateDemoLiquidationPrice,
  calculateDemoUnrealizedPNL,
  resolveDemoPercentSize,
  resolveDemoSizing,
  type DemoSide,
  type DemoSizing,
  type DemoTradeEditPatch,
} from './demoEngine'

export type DemoChartLineKind = 'position' | 'order' | 'takeProfit' | 'stopLoss' | 'liquidation'

export type DemoChartLine = {
  id: string
  kind: DemoChartLineKind
  price: number
  side: DemoSide
  quantity: number
  pnl: number | null
  roi: number | null
}

export type DemoChartMarker = {
  time: number
  side: DemoSide
}

export type DemoCandle = {
  time: number
  open: number
  high: number
  low: number
  close: number
}

export type DemoChartDisplays = Record<DemoChartDisplayKey, boolean>

type LineTrade = Pick<
  DemoTrade,
  | 'id'
  | 'symbol'
  | 'side'
  | 'quantity'
  | 'entry_price'
  | 'initial_margin'
  | 'margin_mode'
  | 'take_profit'
  | 'stop_loss'
  | 'status'
>

export function calculateDemoPositionRoi(
  trade: Pick<DemoTrade, 'side' | 'entry_price' | 'quantity' | 'initial_margin'>,
  markPrice: number | null
): { pnl: number | null; roi: number | null } {
  if (markPrice == null || !Number.isFinite(markPrice)) return { pnl: null, roi: null }
  const pnl = calculateDemoUnrealizedPNL(trade.side, trade.entry_price, markPrice, trade.quantity)
  const margin = trade.initial_margin ?? 0
  return { pnl, roi: margin > 0 ? (pnl / margin) * 100 : null }
}

export function resolveDemoChartPricePrecision(price: number | null | undefined): number {
  if (price == null || !Number.isFinite(price) || price <= 0) return DEMO_CHART_PRICE_DECIMALS_HIGH
  if (price >= DEMO_CHART_HIGH_PRICE) return DEMO_CHART_PRICE_DECIMALS_HIGH
  if (price >= 1) return DEMO_CHART_PRICE_DECIMALS_MID
  return Math.min(DEMO_PRICE_MAX_DECIMALS, Math.ceil(-Math.log10(price)) + DEMO_PRICE_SIGNIFICANT_DIGITS - 1)
}

export function buildDemoChartLines(params: {
  symbol: string
  positions: LineTrade[]
  pending: LineTrade[]
  markPrice: number | null
  balance: number | null
  displays: DemoChartDisplays
}): DemoChartLine[] {
  const { symbol, markPrice, balance, displays } = params
  const lines: DemoChartLine[] = []
  const positions = params.positions.filter((trade) => trade.symbol === symbol)
  const pending = params.pending.filter((trade) => trade.symbol === symbol)

  if (displays.positionDetails || displays.estLiquidation) {
    for (const position of positions) {
      if (displays.positionDetails) {
        const { pnl, roi } = calculateDemoPositionRoi(position, markPrice)
        lines.push({
          id: `${position.id}:position`,
          kind: 'position',
          price: position.entry_price,
          side: position.side,
          quantity: position.quantity,
          pnl,
          roi,
        })
      }
      if (displays.estLiquidation) {
        const liquidation = calculateDemoLiquidationPrice({
          side: position.side,
          entryPrice: position.entry_price,
          quantity: position.quantity,
          margin: position.initial_margin ?? 0,
          marginMode: position.margin_mode ?? 'cross',
          availableBalance: balance ?? 0,
        })
        if (liquidation !== null && liquidation > 0) {
          lines.push({
            id: `${position.id}:liquidation`,
            kind: 'liquidation',
            price: liquidation,
            side: position.side,
            quantity: position.quantity,
            pnl: null,
            roi: null,
          })
        }
      }
    }
  }

  if (displays.openOrders) {
    for (const order of pending) {
      lines.push({
        id: `${order.id}:order`,
        kind: 'order',
        price: order.entry_price,
        side: order.side,
        quantity: order.quantity,
        pnl: null,
        roi: null,
      })
    }
    for (const trade of [...positions, ...pending]) {
      if (trade.take_profit != null) {
        lines.push({
          id: `${trade.id}:takeProfit`,
          kind: 'takeProfit',
          price: trade.take_profit,
          side: trade.side,
          quantity: trade.quantity,
          pnl: null,
          roi: null,
        })
      }
      if (trade.stop_loss != null) {
        lines.push({
          id: `${trade.id}:stopLoss`,
          kind: 'stopLoss',
          price: trade.stop_loss,
          side: trade.side,
          quantity: trade.quantity,
          pnl: null,
          roi: null,
        })
      }
    }
  }

  return lines
}

export function snapDemoCandleTime(epochSeconds: number, interval: DemoChartInterval): number {
  const step = DEMO_CHART_INTERVAL_SECONDS[interval]
  return Math.floor(epochSeconds / step) * step
}

export function buildDemoChartMarkers(params: {
  symbol: string
  trades: Pick<DemoTrade, 'symbol' | 'side' | 'status' | 'opened_at' | 'filled_at' | 'closed_at'>[]
  interval: DemoChartInterval
  firstCandleTime: number | null
}): DemoChartMarker[] {
  const { symbol, trades, interval, firstCandleTime } = params
  if (firstCandleTime === null) return []
  const markers: DemoChartMarker[] = []

  const push = (iso: string | null, side: DemoSide): void => {
    if (!iso) return
    const ms = Date.parse(iso)
    if (!Number.isFinite(ms)) return
    const time = snapDemoCandleTime(Math.floor(ms / 1000), interval)
    if (time >= firstCandleTime) markers.push({ time, side })
  }

  for (const trade of trades) {
    if (trade.symbol !== symbol) continue
    if (trade.status === 'open' || trade.status === 'closed') {
      push(trade.filled_at ?? trade.opened_at, trade.side)
    }
    if (trade.status === 'closed') {
      push(trade.closed_at, trade.side === 'buy' ? 'sell' : 'buy')
    }
  }

  return markers.sort((a, b) => a.time - b.time)
}

export function parseDemoKlineRow(row: unknown): DemoCandle | null {
  if (!Array.isArray(row) || row.length < 5) return null
  const [openTime, open, high, low, close] = row
  const candle = {
    time: Math.floor(Number(openTime) / 1000),
    open: Number(open),
    high: Number(high),
    low: Number(low),
    close: Number(close),
  }
  return Object.values(candle).every((value) => Number.isFinite(value)) ? candle : null
}

export function parseDemoKlineMessage(raw: unknown): DemoCandle | null {
  if (!raw || typeof raw !== 'object') return null
  const kline = (raw as { k?: Record<string, unknown> }).k
  if (!kline) return null
  return parseDemoKlineRow([kline.t, kline.o, kline.h, kline.l, kline.c])
}

export function resolveDemoFastOrderSize(params: {
  mode: DemoSizeMode
  size: number | null
  percent: number | null
  available: number | null
  leverage: number
  price: number
}): { size: number; sizing: DemoSizing } | null {
  const { mode, percent, available, leverage, price } = params
  const size =
    percent !== null
      ? available !== null
        ? resolveDemoPercentSize({ mode, percent, available, leverage, price })
        : null
      : params.size
  if (size === null || !(size > 0)) return null
  const sizing = resolveDemoSizing(mode, size, leverage, price)
  return sizing ? { size, sizing } : null
}

export type DemoTickerQuote = { symbol: string; price: number; changePercent: number | null }

export function parseDemoTickerMessage(raw: unknown): DemoTickerQuote | null {
  if (!raw || typeof raw !== 'object') return null
  const row = raw as { s?: unknown; c?: unknown; P?: unknown }
  const price = Number(row.c)
  if (typeof row.s !== 'string' || !Number.isFinite(price) || price <= 0) return null
  const change = row.P === undefined || row.P === null ? NaN : Number(row.P)
  return { symbol: row.s, price, changePercent: Number.isFinite(change) ? change : null }
}

export function parseDemoTickerRest(raw: unknown): DemoTickerQuote | null {
  if (!raw || typeof raw !== 'object') return null
  const row = raw as { symbol?: unknown; lastPrice?: unknown; priceChangePercent?: unknown }
  return parseDemoTickerMessage({ s: row.symbol, c: row.lastPrice, P: row.priceChangePercent })
}

export function buildDemoSubscribeMessage(symbols: string[], id: number): string {
  return JSON.stringify({
    method: 'SUBSCRIBE',
    params: symbols.map((symbol) => `${symbol.toLowerCase()}@ticker`),
    id,
  })
}

export function resolveDemoTvSymbol(pair: { symbol: string; market: DemoMarket }): string {
  const suffix = pair.market === 'futures' ? DEMO_TV_FUTURES_SUFFIX : ''
  return `${DEMO_TV_EXCHANGE_PREFIX}${pair.symbol}${suffix}`
}

export function mergeDemoCandles(older: DemoCandle[], current: DemoCandle[]): DemoCandle[] {
  const byTime = new Map<number, DemoCandle>()
  for (const candle of older) byTime.set(candle.time, candle)
  for (const candle of current) byTime.set(candle.time, candle)
  return Array.from(byTime.values()).sort((a, b) => a.time - b.time)
}

export function upsertDemoCandle(list: DemoCandle[], candle: DemoCandle): DemoCandle[] {
  const last = list[list.length - 1]
  if (!last || candle.time > last.time) return [...list, candle]
  if (candle.time === last.time) return [...list.slice(0, -1), candle]
  return list
}

export function resolveDemoOlderRequest(params: {
  oldestTime: number | null
  total: number
  maxTotal: number
  pageLimit: number
}): { endTimeMs: number; limit: number } | null {
  const { oldestTime, total, maxTotal, pageLimit } = params
  if (oldestTime === null || total >= maxTotal) return null
  return { endTimeMs: oldestTime * 1000 - 1, limit: Math.min(pageLimit, maxTotal - total) }
}

export function parseDemoLineId(id: string): { tradeId: string; kind: DemoChartLineKind } {
  const [tradeId, kind] = id.split(':')
  return { tradeId, kind: kind as DemoChartLineKind }
}

export function buildDemoLineEdit(kind: DemoChartLineKind, price: number): DemoTradeEditPatch | null {
  if (kind === 'takeProfit') return { takeProfit: price }
  if (kind === 'stopLoss') return { stopLoss: price }
  if (kind === 'order') return { price }
  return null
}
