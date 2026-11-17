import { describe, expect, it } from 'vitest'
import {
  resolveDemoTradeLiquidation,
  sortDemoTradesByActivity,
  validateDemoTpSlLevels,
  validateDemoTradeEdit,
  willDemoLimitFillImmediately,
} from '@/lib/engines/demoEngine'
import {
  buildDemoLineEdit,
  mergeDemoCandles,
  parseDemoLineId,
  parseDemoTickerMessage,
  parseDemoTickerRest,
  resolveDemoOlderRequest,
  resolveDemoTvSymbol,
  upsertDemoCandle,
} from '@/lib/engines/demoChartOverlays'
import { formatChangePercent } from '@/components/features/demo-trading/demoFormat'
import { buildLoginRedirectUrl } from '@/components/features/demo-trading/useDemoAccount'

const base = {
  side: 'buy' as const,
  entryPrice: 100,
  markPrice: 110,
  isOpen: true,
  takeProfit: null,
  stopLoss: null,
  liquidationPrice: 80,
}

describe('validateDemoTpSlLevels', () => {
  it('accepts a valid long', () => {
    expect(validateDemoTpSlLevels({ ...base, takeProfit: 120, stopLoss: 95 })).toBeNull()
  })

  it('uses mark for open positions and entry for pending', () => {
    expect(validateDemoTpSlLevels({ ...base, takeProfit: 105 })).toBe('INVALID_TP')
    expect(validateDemoTpSlLevels({ ...base, isOpen: false, takeProfit: 105 })).toBeNull()
    expect(validateDemoTpSlLevels({ ...base, stopLoss: 115 })).toBe('INVALID_SL')
    expect(validateDemoTpSlLevels({ ...base, isOpen: false, stopLoss: 105 })).toBe('INVALID_SL')
  })

  it('rejects sl at or beyond liquidation', () => {
    expect(validateDemoTpSlLevels({ ...base, stopLoss: 80 })).toBe('SL_BEYOND_LIQUIDATION')
    expect(validateDemoTpSlLevels({ ...base, stopLoss: 79 })).toBe('SL_BEYOND_LIQUIDATION')
  })

  it('rejects non-positive, NaN and equal levels', () => {
    expect(validateDemoTpSlLevels({ ...base, takeProfit: 0 })).toBe('INVALID_PRICE')
    expect(validateDemoTpSlLevels({ ...base, stopLoss: -1 })).toBe('INVALID_PRICE')
    expect(validateDemoTpSlLevels({ ...base, takeProfit: NaN })).toBe('INVALID_PRICE')
    expect(validateDemoTpSlLevels({ ...base, takeProfit: 120, stopLoss: 120 })).toBe('TP_SL_EQUAL')
  })

  it('mirrors for shorts', () => {
    const short = { ...base, side: 'sell' as const, markPrice: 90, liquidationPrice: 120 }
    expect(validateDemoTpSlLevels({ ...short, takeProfit: 80, stopLoss: 95 })).toBeNull()
    expect(validateDemoTpSlLevels({ ...short, takeProfit: 95 })).toBe('INVALID_TP')
    expect(validateDemoTpSlLevels({ ...short, stopLoss: 85 })).toBe('INVALID_SL')
    expect(validateDemoTpSlLevels({ ...short, stopLoss: 125 })).toBe('SL_BEYOND_LIQUIDATION')
  })
})

describe('validateDemoTradeEdit', () => {
  const position = {
    side: 'buy' as const,
    status: 'open' as const,
    entry_price: 100,
    take_profit: 130,
    stop_loss: 90,
  }

  it('merges the patch with existing levels', () => {
    expect(validateDemoTradeEdit(position, { stopLoss: 140 }, 110, 50)).toBe('INVALID_SL')
    expect(validateDemoTradeEdit(position, { takeProfit: 95 }, 110, 50)).toBe('INVALID_TP')
    expect(validateDemoTradeEdit(position, { takeProfit: null, stopLoss: 95 }, 110, 50)).toBeNull()
  })

  it('validates a pending entry price against its own levels', () => {
    const pending = { ...position, status: 'pending' as const }
    expect(validateDemoTradeEdit(pending, { price: 85 }, 110, null)).toBe('INVALID_SL')
    expect(validateDemoTradeEdit(pending, { price: 0 }, 110, null)).toBe('INVALID_PRICE')
    expect(validateDemoTradeEdit(pending, { price: 95 }, 110, null)).toBeNull()
  })
})

describe('willDemoLimitFillImmediately', () => {
  it('flags a long limit at or above mark', () => {
    expect(willDemoLimitFillImmediately('buy', 110, 100)).toBe(true)
    expect(willDemoLimitFillImmediately('buy', 90, 100)).toBe(false)
    expect(willDemoLimitFillImmediately('sell', 90, 100)).toBe(true)
    expect(willDemoLimitFillImmediately('buy', 90, null)).toBe(false)
  })
})

describe('resolveDemoTradeLiquidation', () => {
  const open = {
    side: 'buy' as const,
    status: 'open' as const,
    entry_price: 100,
    quantity: 1,
    initial_margin: 10,
    margin_mode: 'isolated' as const,
    liquidation_price: null,
  }

  it('prefers the stored price, otherwise computes, and skips non-open trades', () => {
    expect(resolveDemoTradeLiquidation({ ...open, liquidation_price: 91 }, 0)).toBe(91)
    expect(resolveDemoTradeLiquidation(open, 0)).toBeGreaterThan(0)
    expect(resolveDemoTradeLiquidation({ ...open, status: 'pending' as never }, 0)).toBeNull()
  })
})

describe('chart edit helpers', () => {
  it('maps line kinds to patches', () => {
    expect(buildDemoLineEdit('takeProfit', 5)).toEqual({ takeProfit: 5 })
    expect(buildDemoLineEdit('stopLoss', 5)).toEqual({ stopLoss: 5 })
    expect(buildDemoLineEdit('order', 5)).toEqual({ price: 5 })
    expect(buildDemoLineEdit('liquidation', 5)).toBeNull()
    expect(parseDemoLineId('abc:stopLoss')).toEqual({ tradeId: 'abc', kind: 'stopLoss' })
  })
})

describe('candle pagination helpers', () => {
  const candle = (time: number, close = 1) => ({ time, open: 1, high: 1, low: 1, close })

  it('merges older candles without duplicates, sorted', () => {
    const merged = mergeDemoCandles([candle(1), candle(2), candle(3, 9)], [candle(3), candle(4)])
    expect(merged.map((item) => item.time)).toEqual([1, 2, 3, 4])
    expect(merged[2].close).toBe(1)
  })

  it('upserts the live candle', () => {
    expect(upsertDemoCandle([candle(1)], candle(1, 5))[0].close).toBe(5)
    expect(upsertDemoCandle([candle(1)], candle(2)).length).toBe(2)
    expect(upsertDemoCandle([candle(2)], candle(1)).length).toBe(1)
  })

  it('builds an end-time paginated request and caps the total', () => {
    expect(resolveDemoOlderRequest({ oldestTime: 1000, total: 500, maxTotal: 5000, pageLimit: 1000 })).toEqual({
      endTimeMs: 999999,
      limit: 1000,
    })
    expect(resolveDemoOlderRequest({ oldestTime: 1000, total: 4500, maxTotal: 5000, pageLimit: 1000 })?.limit).toBe(500)
    expect(resolveDemoOlderRequest({ oldestTime: 1000, total: 5000, maxTotal: 5000, pageLimit: 1000 })).toBeNull()
    expect(resolveDemoOlderRequest({ oldestTime: null, total: 0, maxTotal: 5000, pageLimit: 1000 })).toBeNull()
  })
})

describe('ticker parsing and formatting', () => {
  it('parses ws and rest ticker rows', () => {
    expect(parseDemoTickerMessage({ s: 'DOGEUSDT', c: '0.2', P: '-1.5' })).toEqual({
      symbol: 'DOGEUSDT',
      price: 0.2,
      changePercent: -1.5,
    })
    expect(parseDemoTickerRest({ symbol: 'NVDAUSDT', lastPrice: '150', priceChangePercent: '2.1' })?.changePercent).toBe(2.1)
    expect(parseDemoTickerMessage({ s: 'X', c: '0' })).toBeNull()
    expect(parseDemoTickerMessage({ s: 'X', c: '1' })?.changePercent).toBeNull()
  })

  it('formats the 24h change with sign', () => {
    expect(formatChangePercent(1.234)).toBe('+1.23%')
    expect(formatChangePercent(-0.5)).toBe('-0.50%')
    expect(formatChangePercent(null)).toBe('--')
  })
})

describe('tradingview symbol and login redirect', () => {
  it('uses .P only for futures', () => {
    expect(resolveDemoTvSymbol({ symbol: 'BTCUSDT', market: 'spot' })).toBe('BINANCE:BTCUSDT')
    expect(resolveDemoTvSymbol({ symbol: 'NVDAUSDT', market: 'futures' })).toBe('BINANCE:NVDAUSDT.P')
  })

  it('builds the login redirect with the current path', () => {
    expect(buildLoginRedirectUrl('/demo-trading', '?a=1')).toBe('/login?next=%2Fdemo-trading%3Fa%3D1')
  })
})

describe('sortDemoTradesByActivity', () => {
  it('puts the most recently closed trade first even if it was opened earlier', () => {
    const older = { id: 'a', opened_at: '2026-01-01T00:00:00Z', filled_at: null, closed_at: '2026-01-03T00:00:00Z' }
    const newer = { id: 'b', opened_at: '2026-01-02T00:00:00Z', filled_at: null, closed_at: '2026-01-02T12:00:00Z' }
    expect(sortDemoTradesByActivity([newer, older]).map((trade) => trade.id)).toEqual(['a', 'b'])
  })
})
