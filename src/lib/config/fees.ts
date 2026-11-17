export const FEE_TRADE_TYPES = ['spot', 'futures'] as const

export const USD_LIKE_CURRENCIES = ['USDT', 'USDC', 'USD', 'BUSD', 'FDUSD', 'TUSD', 'DAI'] as const

export const FEE_USD_PRECISION = 8

export const FEE_DAILY_SERIES_DAYS = 365

export const FEE_RING_COLORS = {
  volume: ['#15803d', '#6bd04e', '#0f9d8a', '#46c987', '#8aa31a'],
  fee: ['#c92a2a', '#ff8a7a', '#b3265f', '#ff6a4d', '#e0507a'],
} as const

export const FEE_RINGS = ['volume', 'fee'] as const
export type FeeRing = (typeof FEE_RINGS)[number]

export const FEE_RING_RADII = {
  volume: { inner: '66%', outer: '88%' },
  fee: { inner: '40%', outer: '60%' },
} as const

export const FEE_RING_DIM_OPACITY = 0.22
export const FEE_RING_PADDING_ANGLE = 2
export const FEE_RING_MIN_ANGLE = 3
export const FEE_RING_CHART_MARGIN = { top: 8, right: 8, bottom: 8, left: 8 } as const
export const FEE_PERIOD_DEFAULT = 'd30'

export const FEE_CHART_HEIGHT = 340
export const FEE_PERCENT_DECIMALS = 2
export const FEE_USD_DECIMALS = 2
export const FEE_SMALL_USD_DECIMALS = 4
export const FEE_SMALL_USD_THRESHOLD = 1
export const FEE_RATE_DECIMALS = 3
export const FEE_TOOLTIP_Z_INDEX = 10
export const PERCENT_SCALE = 100
export const FULL_CIRCLE_DEGREES = 360
