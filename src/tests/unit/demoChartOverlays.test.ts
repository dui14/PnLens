import { describe, expect, it } from 'vitest'
import { resolveDemoPercentSize } from '@/lib/engines/demoEngine'
import { DEMO_CHART_DISPLAY_DEFAULTS } from '@/lib/config/demoTrading'
import {
  buildDemoChartLines,
  buildDemoChartMarkers,
  calculateDemoPositionRoi,
  parseDemoKlineMessage,
  parseDemoKlineRow,
  resolveDemoChartPricePrecision,
  resolveDemoFastOrderSize,
  snapDemoCandleTime,
} from '@/lib/engines/demoChartOverlays'

const allOn = {
  positionDetails: true,
  openOrders: true,
  transactionHistory: true,
  estLiquidation: true,
  fastOrder: false,
}

const position = {
  id: 'p1',
  symbol: 'BTCUSDT',
  side: 'buy' as const,
  quantity: 2,
  entry_price: 100,
  initial_margin: 20,
  margin_mode: 'isolated' as const,
  take_profit: 130,
  stop_loss: 90,
  status: 'open' as const,
}

const pending = {
  ...position,
  id: 'o1',
  entry_price: 95,
  take_profit: null,
  stop_loss: null,
  status: 'pending' as const,
}

describe('calculateDemoPositionRoi', () => {
  it('computes pnl and roi against margin', () => {
    expect(calculateDemoPositionRoi(position, 110)).toEqual({ pnl: 20, roi: 100 })
  })

  it('inverts for shorts', () => {
    expect(calculateDemoPositionRoi({ ...position, side: 'sell' }, 110).pnl).toBe(-20)
  })

  it('returns nulls without a mark price', () => {
    expect(calculateDemoPositionRoi(position, null)).toEqual({ pnl: null, roi: null })
  })
})

describe('buildDemoChartLines', () => {
  const base = { symbol: 'BTCUSDT', positions: [position], pending: [pending], markPrice: 110, balance: 1000 }

  it('builds position, liquidation, order, tp and sl lines', () => {
    const kinds = buildDemoChartLines({ ...base, displays: allOn }).map((line) => line.kind)
    expect(kinds.sort()).toEqual(['liquidation', 'order', 'position', 'stopLoss', 'takeProfit'])
  })

  it('carries live pnl and roi on the position line', () => {
    const line = buildDemoChartLines({ ...base, displays: allOn }).find((item) => item.kind === 'position')
    expect(line).toMatchObject({ price: 100, pnl: 20, roi: 100 })
  })

  it('respects display toggles', () => {
    expect(buildDemoChartLines({ ...base, displays: { ...allOn, positionDetails: false, estLiquidation: false, openOrders: false } })).toEqual([])
    const onlyLiq = buildDemoChartLines({ ...base, displays: { ...allOn, positionDetails: false, openOrders: false } })
    expect(onlyLiq.map((line) => line.kind)).toEqual(['liquidation'])
    expect(onlyLiq[0].price).toBeLessThan(100)
  })

  it('ignores other symbols', () => {
    expect(buildDemoChartLines({ ...base, symbol: 'ETHUSDT', displays: allOn })).toEqual([])
  })

  it('keeps fast order off by default', () => {
    expect(DEMO_CHART_DISPLAY_DEFAULTS.fastOrder).toBe(false)
  })
})

describe('buildDemoChartMarkers', () => {
  const t0 = Date.parse('2026-01-01T10:20:30Z')
  const trade = {
    symbol: 'BTCUSDT',
    side: 'buy' as const,
    status: 'closed' as const,
    opened_at: new Date(t0).toISOString(),
    filled_at: new Date(t0).toISOString(),
    closed_at: new Date(t0 + 2 * 3600 * 1000).toISOString(),
  }

  it('snaps to candle open', () => {
    expect(snapDemoCandleTime(Math.floor(t0 / 1000), '1h')).toBe(Math.floor(Date.parse('2026-01-01T10:00:00Z') / 1000))
  })

  it('emits entry and opposite exit markers sorted by time', () => {
    const markers = buildDemoChartMarkers({ symbol: 'BTCUSDT', trades: [trade], interval: '1h', firstCandleTime: 0 })
    expect(markers.map((marker) => marker.side)).toEqual(['buy', 'sell'])
    expect(markers[0].time).toBeLessThan(markers[1].time)
  })

  it('drops other symbols, pending trades and markers before the first candle', () => {
    const pendingTrade = { ...trade, status: 'pending' as const }
    expect(buildDemoChartMarkers({ symbol: 'ETHUSDT', trades: [trade], interval: '1h', firstCandleTime: 0 })).toEqual([])
    expect(buildDemoChartMarkers({ symbol: 'BTCUSDT', trades: [pendingTrade], interval: '1h', firstCandleTime: 0 })).toEqual([])
    expect(buildDemoChartMarkers({ symbol: 'BTCUSDT', trades: [trade], interval: '1h', firstCandleTime: Number.MAX_SAFE_INTEGER })).toEqual([])
    expect(buildDemoChartMarkers({ symbol: 'BTCUSDT', trades: [trade], interval: '1h', firstCandleTime: null })).toEqual([])
  })
})

describe('kline parsing', () => {
  it('parses a REST row', () => {
    expect(parseDemoKlineRow([1700000000000, '1', '2', '0.5', '1.5'])).toEqual({
      time: 1700000000,
      open: 1,
      high: 2,
      low: 0.5,
      close: 1.5,
    })
    expect(parseDemoKlineRow(['x'])).toBeNull()
  })

  it('parses a WS message', () => {
    expect(parseDemoKlineMessage({ k: { t: 1700000000000, o: '1', h: '2', l: '1', c: '2' } })?.close).toBe(2)
    expect(parseDemoKlineMessage({})).toBeNull()
  })
})

describe('resolveDemoChartPricePrecision', () => {
  it('adapts to price magnitude', () => {
    expect(resolveDemoChartPricePrecision(65000)).toBe(2)
    expect(resolveDemoChartPricePrecision(15.5)).toBe(4)
    expect(resolveDemoChartPricePrecision(0.00000391)).toBe(9)
    expect(resolveDemoChartPricePrecision(null)).toBe(2)
  })
})

describe('resolveDemoFastOrderSize', () => {
  const base = { mode: 'quantity' as const, size: null, available: 1000, leverage: 10 }

  it('recomputes a percent size at the clicked price', () => {
    const low = resolveDemoFastOrderSize({ ...base, percent: 50, price: 50 })
    const high = resolveDemoFastOrderSize({ ...base, percent: 50, price: 100 })
    expect(low?.size).toBe(resolveDemoPercentSize({ ...base, percent: 50, price: 50 }))
    expect(low?.size).toBeGreaterThan((high?.size ?? 0) * 1.9)
    expect(low?.sizing.notional).toBeCloseTo(high?.sizing.notional ?? 0, 0)
  })

  it('uses the typed size when no percent is selected', () => {
    const result = resolveDemoFastOrderSize({ ...base, size: 2, percent: null, price: 100 })
    expect(result?.sizing.quantity).toBe(2)
  })

  it('returns null for missing size or balance', () => {
    expect(resolveDemoFastOrderSize({ ...base, size: null, percent: null, price: 100 })).toBeNull()
    expect(resolveDemoFastOrderSize({ ...base, percent: 50, available: null, price: 100 })).toBeNull()
  })
})
