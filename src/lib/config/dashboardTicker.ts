export const DASHBOARD_TICKER_SYMBOLS = [
  'BTCUSDT',
  'ETHUSDT',
  'SOLUSDT',
  'BNBUSDT',
  'XRPUSDT',
  'NVDAUSDT',
  'AAPLUSDT',
  'TSLAUSDT',
  'MSFTUSDT',
  'XAUUSDT',
] as const

export const DASHBOARD_TICKER_SCROLL_SECONDS = 70
export const DASHBOARD_TICKER_FLUSH_INTERVAL_MS = 1000
export const DASHBOARD_TICKER_RECONNECT_BASE_MS = 1000
export const DASHBOARD_TICKER_RECONNECT_MAX_MS = 30000
export const DASHBOARD_TICKER_STREAM_SUFFIX = '@ticker'
export const DASHBOARD_TICKER_PLACEHOLDER = '--'
export const DASHBOARD_TICKER_COMBINED_PATH = '/stream'
export const DASHBOARD_TICKER_PRICE_TIERS = [
  { min: 1000, decimals: 2 },
  { min: 1, decimals: 3 },
  { min: 0, decimals: 5 },
] as const
