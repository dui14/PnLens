export const DEMO_MARKETS = ['spot', 'futures'] as const
export type DemoMarket = (typeof DEMO_MARKETS)[number]
export const DEMO_TAKER_FEE_RATE = 0.001
export const DEMO_MAINTENANCE_MARGIN_RATE = 0.004
export const DEMO_MIN_LEVERAGE = 1
export const DEMO_MAX_LEVERAGE = 200
export const DEMO_DEFAULT_LEVERAGE = 10
export const DEMO_LEVERAGE_PRESETS = [1, 5, 10, 20, 50, 100, 200] as const
export const DEMO_REFILL_THRESHOLD = 500
export const DEMO_REFILL_BALANCE = 10000
export const DEMO_SYNC_INTERVAL_MS = 4000
export const DEMO_LOGIN_PATH = '/login'
export const DEMO_PRICE_API_URL = 'https://api.binance.com/api/v3/ticker/price'
export const DEMO_PRICE_TIMEOUT_MS = 4000
export const DEMO_PRICE_WS_URL = 'wss://stream.binance.com:9443/ws'
export const DEMO_FUTURES_PRICE_API_URL = 'https://fapi.binance.com/fapi/v1/ticker/price'
export const DEMO_FUTURES_PRICE_WS_URL = 'wss://fstream.binance.com/market/ws'
export const DEMO_TICKER_24H_API_URL = 'https://api.binance.com/api/v3/ticker/24hr'
export const DEMO_FUTURES_TICKER_24H_API_URL = 'https://fapi.binance.com/fapi/v1/ticker/24hr'
export const DEMO_WS_RECONNECT_MS = 3000
export const DEMO_CHANGE_DECIMALS = 2
export const DEMO_PRICE_DEFAULT_MAX_DECIMALS = 6
export const DEMO_PRICE_MAX_DECIMALS = 12
export const DEMO_PRICE_SIGNIFICANT_DIGITS = 4
export const DEMO_KLINES_API_URL = 'https://api.binance.com/api/v3/klines'
export const DEMO_FUTURES_KLINES_API_URL = 'https://fapi.binance.com/fapi/v1/klines'
export const DEMO_CHART_INTERVAL_SECONDS = {
  '1m': 60,
  '5m': 300,
  '15m': 900,
  '1h': 3600,
  '4h': 14400,
  '1d': 86400,
} as const
export type DemoChartInterval = keyof typeof DEMO_CHART_INTERVAL_SECONDS
export const DEMO_CHART_INTERVALS = Object.keys(DEMO_CHART_INTERVAL_SECONDS) as DemoChartInterval[]
export const DEMO_CHART_DEFAULT_INTERVAL: DemoChartInterval = '1h'
export const DEMO_CHART_CANDLE_LIMIT = 500
export const DEMO_CHART_MAX_CANDLES = 5000
export const DEMO_CHART_PAGE_LIMIT: Record<DemoMarket, number> = { spot: 1000, futures: 1500 }
export const DEMO_CHART_LOAD_MORE_THRESHOLD = 20
export const DEMO_CHART_DRAG_HIT_PX = 6
export const DEMO_CHART_MODES = ['trading', 'tradingview'] as const
export type DemoChartMode = (typeof DEMO_CHART_MODES)[number]
export const DEMO_CHART_DEFAULT_MODE: DemoChartMode = 'trading'
export const DEMO_CHART_MODE_STORAGE_KEY = 'pnlens.demo.chartMode'
export const DEMO_TV_SCRIPT_URL = 'https://s3.tradingview.com/tv.js'
export const DEMO_TV_CONTAINER_ID = 'tv_demo_chart'
export const DEMO_TV_INTERVAL = '60'
export const DEMO_TV_FUTURES_SUFFIX = '.P'
export const DEMO_TV_EXCHANGE_PREFIX = 'BINANCE:'
export const DEMO_CHART_DISPLAY_KEYS = [
  'positionDetails',
  'openOrders',
  'transactionHistory',
  'estLiquidation',
  'fastOrder',
] as const
export type DemoChartDisplayKey = (typeof DEMO_CHART_DISPLAY_KEYS)[number]
export const DEMO_CHART_DISPLAY_DEFAULTS: Record<DemoChartDisplayKey, boolean> = {
  positionDetails: true,
  openOrders: true,
  transactionHistory: true,
  estLiquidation: true,
  fastOrder: false,
}
export const DEMO_CHART_DISPLAY_STORAGE_KEY = 'pnlens.demo.chartDisplays'
export const DEMO_CHART_PRICE_DECIMALS_HIGH = 2
export const DEMO_CHART_PRICE_DECIMALS_MID = 4
export const DEMO_CHART_HIGH_PRICE = 100
export const DEMO_CHART_COLORS = {
  background: '#18161c',
  text: '#94a3b8',
  grid: 'rgba(95, 74, 140, 0.15)',
  border: 'rgba(95, 74, 140, 0.3)',
  up: '#34d399',
  down: '#fb7185',
  position: '#a78bfa',
  order: '#38bdf8',
  takeProfit: '#34d399',
  stopLoss: '#fb7185',
  liquidation: '#ef4444',
  buyMarker: '#34d399',
  sellMarker: '#fb7185',
} as const
export const DEMO_CHART_LINE_WIDTH = 1
export const DEMO_CHART_PNL_DECIMALS = 2
export const DEMO_SIZE_MODES = ['quantity', 'cost', 'value'] as const
export type DemoSizeMode = (typeof DEMO_SIZE_MODES)[number]
export const DEMO_DEFAULT_SIZE_MODE: DemoSizeMode = 'cost'
export const DEMO_MAX_SIZE_INPUT = 1_000_000_000_000
export const DEMO_SIZE_PERCENT_PRESETS = [10, 25, 50, 75, 100] as const
export const DEMO_SIZE_PRECISION: Record<DemoSizeMode, number> = { quantity: 6, cost: 2, value: 2 }
export const DEMO_SIZE_FLOAT_GUARD = 1 - 1e-9
export const DEMO_QUANTITY_PRICE_BUFFER = 0.999

export const DEMO_PAIR_CATEGORIES = ['crypto', 'stocks', 'commodities'] as const
export type DemoPairCategory = (typeof DEMO_PAIR_CATEGORIES)[number]
export const DEMO_QUOTE_ASSET = 'USDT'

export type DemoMarketPair = {
  symbol: string
  label: string
  baseAsset: string
  market: DemoMarket
  category: DemoPairCategory
}

function buildPair(base: string, market: DemoMarket, category: DemoPairCategory): DemoMarketPair {
  const symbol = `${base}${DEMO_QUOTE_ASSET}`
  return {
    symbol,
    label: `${base}/${DEMO_QUOTE_ASSET}`,
    baseAsset: base,
    market,
    category,
  }
}

const SPOT_CRYPTO_BASES = [
  'BTC', 'ETH', 'SOL', 'AVAX', 'BNB', 'XRP', 'DOGE', 'SUI', 'PEPE', 'LINK', 'ADA', 'NEAR', 'APT', 'ARB',
] as const
const FUTURES_STOCK_BASES = [
  'NVDA', 'AAPL', 'MSFT', 'TSLA', 'AMZN', 'META', 'GOOGL', 'AMD', 'NFLX', 'COIN',
] as const
const FUTURES_COMMODITY_BASES = ['XAU', 'XAG'] as const

export const DEMO_MARKET_PAIRS: DemoMarketPair[] = [
  ...SPOT_CRYPTO_BASES.map((base) => buildPair(base, 'spot', 'crypto')),
  ...FUTURES_STOCK_BASES.map((base) => buildPair(base, 'futures', 'stocks')),
  ...FUTURES_COMMODITY_BASES.map((base) => buildPair(base, 'futures', 'commodities')),
]

export const DEMO_MARKET_BY_SYMBOL: Record<string, DemoMarket> = Object.fromEntries(
  DEMO_MARKET_PAIRS.map((pair) => [pair.symbol, pair.market])
)

export const DEMO_SYMBOLS: string[] = DEMO_MARKET_PAIRS.map((pair) => pair.symbol)
export const DEMO_DEFAULT_SYMBOL = DEMO_MARKET_PAIRS[0].symbol

export const DEMO_ERROR_STATUS: Record<string, number> = {
  UNAUTHORIZED: 401,
  VALIDATION_ERROR: 400,
  INSUFFICIENT_BALANCE: 400,
  INVALID_SIZE: 400,
  INVALID_TP_SL: 400,
  INVALID_PRICE: 400,
  INVALID_TP: 400,
  INVALID_SL: 400,
  TP_SL_EQUAL: 400,
  SL_BEYOND_LIQUIDATION: 400,
  PARENT_NOT_OPEN: 400,
  MIGRATION_REQUIRED: 503,
  INVALID_CLOSE_QUANTITY: 400,
  TRADE_NOT_OPEN: 400,
  TRADE_NOT_PENDING: 400,
  REFILL_NOT_ALLOWED: 400,
  NOT_FOUND: 404,
  PRICE_UNAVAILABLE: 503,
  INTERNAL_ERROR: 500,
}
