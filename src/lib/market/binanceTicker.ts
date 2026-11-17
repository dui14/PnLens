import {
  DASHBOARD_TICKER_COMBINED_PATH,
  DASHBOARD_TICKER_PLACEHOLDER,
  DASHBOARD_TICKER_PRICE_TIERS,
  DASHBOARD_TICKER_RECONNECT_BASE_MS,
  DASHBOARD_TICKER_RECONNECT_MAX_MS,
  DASHBOARD_TICKER_STREAM_SUFFIX,
} from '@/lib/config/dashboardTicker'
import {
  DEMO_FUTURES_PRICE_WS_URL,
  DEMO_MARKET_BY_SYMBOL,
  DEMO_PRICE_WS_URL,
  DEMO_QUOTE_ASSET,
  type DemoMarket,
} from '@/lib/config/demoTrading'

export type TickerQuote = {
  symbol: string
  price: string
  change: string
  changePositive: boolean | null
}

type BinanceTicker = {
  s?: string
  c?: string
  P?: string
  o?: string
}

const WS_PATH_PATTERN = /\/ws\/?$/

export function marketForSymbol(symbol: string): DemoMarket {
  return DEMO_MARKET_BY_SYMBOL[symbol.toUpperCase()] ?? 'spot'
}

export function groupSymbolsByMarket(symbols: readonly string[]): Record<DemoMarket, string[]> {
  const groups: Record<DemoMarket, string[]> = { spot: [], futures: [] }
  for (const symbol of symbols) {
    groups[marketForSymbol(symbol)].push(symbol.toUpperCase())
  }
  return groups
}

export function buildCombinedStreamUrl(market: DemoMarket, symbols: readonly string[]): string {
  const base = market === 'futures' ? DEMO_FUTURES_PRICE_WS_URL : DEMO_PRICE_WS_URL
  const root = base.replace(WS_PATH_PATTERN, DASHBOARD_TICKER_COMBINED_PATH)
  const streams = symbols
    .map((symbol) => `${symbol.toLowerCase()}${DASHBOARD_TICKER_STREAM_SUFFIX}`)
    .join('/')
  return `${root}?streams=${streams}`
}

export function formatTickerPrice(price: string): string {
  const num = Number.parseFloat(price)
  if (!Number.isFinite(num)) return DASHBOARD_TICKER_PLACEHOLDER
  const tier = DASHBOARD_TICKER_PRICE_TIERS.find((t) => num >= t.min) ?? DASHBOARD_TICKER_PRICE_TIERS[2]
  return num.toLocaleString('en-US', {
    minimumFractionDigits: tier.decimals,
    maximumFractionDigits: tier.decimals,
  })
}

function resolveChangePercent(tick: BinanceTicker): number | null {
  const payloadPercent = Number.parseFloat(tick.P ?? '')
  if (Number.isFinite(payloadPercent)) return payloadPercent
  const open = Number.parseFloat(tick.o ?? '')
  const close = Number.parseFloat(tick.c ?? '')
  if (Number.isFinite(open) && open > 0 && Number.isFinite(close)) {
    return ((close - open) / open) * 100
  }
  return null
}

export function parseTickerMessage(raw: string): TickerQuote | null {
  let parsed: { data?: BinanceTicker }
  try {
    parsed = JSON.parse(raw) as { data?: BinanceTicker }
  } catch {
    return null
  }
  const tick = parsed?.data
  if (!tick || typeof tick.s !== 'string' || typeof tick.c !== 'string') return null
  const price = formatTickerPrice(tick.c)
  if (price === DASHBOARD_TICKER_PLACEHOLDER) return null
  const change = resolveChangePercent(tick)
  return {
    symbol: tick.s.toUpperCase(),
    price,
    change: change === null ? DASHBOARD_TICKER_PLACEHOLDER : `${change >= 0 ? '+' : ''}${change.toFixed(2)}%`,
    changePositive: change === null ? null : change >= 0,
  }
}

export function reconnectDelayMs(attempt: number): number {
  return Math.min(DASHBOARD_TICKER_RECONNECT_BASE_MS * 2 ** attempt, DASHBOARD_TICKER_RECONNECT_MAX_MS)
}

export function tickerLabel(symbol: string): string {
  const upper = symbol.toUpperCase()
  return upper.endsWith(DEMO_QUOTE_ASSET) ? upper.slice(0, -DEMO_QUOTE_ASSET.length) : upper
}
