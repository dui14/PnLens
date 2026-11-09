import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Trade } from '@/lib/types'
import {
  buildPNLCalendarDays,
  buildPNLCalendarMonths,
  buildPNLTimeSeries,
  calculatePNLSummary,
  getDateRangeForPeriod,
} from '@/lib/engines/pnlEngine'

const FROZEN_NOW = '2026-06-15T10:30:00.000Z'

function trade(overrides: Partial<Trade> = {}): Trade {
  return {
    id: 'trade-1',
    exchange_account_id: 'account-1',
    user_id: 'user-1',
    external_trade_id: 'ext-1',
    symbol: 'BTCUSDT',
    side: 'buy',
    quantity: 1,
    price: 100,
    fee: 0,
    fee_currency: 'USDT',
    realized_pnl: 0,
    funding_fee: 0,
    income_type: null,
    trade_type: 'futures',
    traded_at: FROZEN_NOW,
    raw_data: null,
    created_at: FROZEN_NOW,
    ...overrides,
  }
}

function localDayKey(iso: string): string {
  const date = new Date(iso)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function localHourKey(iso: string): string {
  const date = new Date(iso)
  return `${localDayKey(iso)} ${String(date.getHours()).padStart(2, '0')}:00`
}

describe('calculatePNLSummary', () => {
  it('returns zeros for an empty trade list', () => {
    expect(calculatePNLSummary([], 'all')).toEqual({
      total_pnl: 0,
      win_rate: 0,
      trade_count: 0,
      win_count: 0,
      loss_count: 0,
      best_trade: null,
      worst_trade: null,
      period: 'all',
    })
  })

  it('sums realized pnl for a long close and a short close without using side, quantity, or price', () => {
    const summary = calculatePNLSummary(
      [
        trade({
          id: 'long-close',
          external_trade_id: 'long-close',
          side: 'sell',
          quantity: 0.25,
          price: 65000,
          fee: 1.5,
          funding_fee: 0.25,
          realized_pnl: 12.5,
        }),
        trade({
          id: 'short-close',
          external_trade_id: 'short-close',
          side: 'buy',
          quantity: 2,
          price: 2400,
          fee: 0.4,
          realized_pnl: -3.25,
        }),
      ],
      'month'
    )

    expect(summary.total_pnl).toBe(9.25)
    expect(summary.win_count).toBe(1)
    expect(summary.loss_count).toBe(1)
    expect(summary.win_rate).toBe(50)
    expect(summary.best_trade).toBe(12.5)
    expect(summary.worst_trade).toBe(-3.25)
    expect(summary.trade_count).toBe(2)
    expect(summary.period).toBe('month')
  })

  it('adds every partial close and does not subtract fees or funding', () => {
    const summary = calculatePNLSummary(
      [
        trade({
          id: 'partial-1',
          external_trade_id: 'partial-1',
          side: 'sell',
          quantity: 0.2,
          fee: 4,
          funding_fee: 1,
          realized_pnl: 1.1,
        }),
        trade({
          id: 'partial-2',
          external_trade_id: 'partial-2',
          side: 'sell',
          quantity: 0.3,
          fee: 6,
          funding_fee: 2,
          realized_pnl: 2.2,
        }),
      ],
      'all'
    )

    expect(summary.total_pnl).toBe(3.3)
    expect(summary.trade_count).toBe(2)
    expect(summary.win_count).toBe(2)
  })

  it('keeps open trades in the count and out of realized pnl', () => {
    const summary = calculatePNLSummary(
      [
        trade({ id: 'closed', external_trade_id: 'closed', realized_pnl: 8 }),
        trade({ id: 'open', external_trade_id: 'open', realized_pnl: null, side: 'buy', quantity: 1 }),
      ],
      'week'
    )

    expect(summary.total_pnl).toBe(8)
    expect(summary.trade_count).toBe(2)
    expect(summary.win_count).toBe(1)
    expect(summary.loss_count).toBe(0)
    expect(summary.win_rate).toBe(100)
  })

  it('does not treat a zero realized pnl as a win or a loss', () => {
    const summary = calculatePNLSummary([trade({ realized_pnl: 0, fee: 2 })], 'day')

    expect(summary.total_pnl).toBe(0)
    expect(summary.win_count).toBe(0)
    expect(summary.loss_count).toBe(0)
    expect(summary.win_rate).toBe(0)
    expect(summary.best_trade).toBeNull()
    expect(summary.worst_trade).toBeNull()
    expect(summary.trade_count).toBe(1)
  })

  it('rounds the total and win rate with the current decimal rules', () => {
    const summary = calculatePNLSummary(
      [
        trade({ id: 'a', external_trade_id: 'a', realized_pnl: 0.1 }),
        trade({ id: 'b', external_trade_id: 'b', realized_pnl: 0.2 }),
        trade({ id: 'c', external_trade_id: 'c', realized_pnl: -0.1 }),
      ],
      'all'
    )

    expect(summary.total_pnl).toBe(parseFloat((0.1 + 0.2 + -0.1).toFixed(8)))
    expect(summary.total_pnl).toBe(0.2)
    expect(summary.win_rate).toBe(66.67)
    expect(summary.best_trade).toBe(0.2)
    expect(summary.worst_trade).toBe(-0.1)
  })

  it('rounds values past 8 decimal places', () => {
    const summary = calculatePNLSummary(
      [
        trade({ id: 'a', external_trade_id: 'a', realized_pnl: 0.000000015 }),
        trade({ id: 'b', external_trade_id: 'b', realized_pnl: 0.000000015 }),
      ],
      'all'
    )

    expect(summary.total_pnl).toBe(parseFloat((0.000000015 + 0.000000015).toFixed(8)))
    expect(summary.best_trade).toBe(parseFloat((0.000000015).toFixed(8)))
  })

  it('keeps numeric strings and turns non-numeric realized pnl into NaN', () => {
    const numeric = calculatePNLSummary(
      [trade({ realized_pnl: '12.50' as unknown as number })],
      'all'
    )
    expect(numeric.total_pnl).toBe(12.5)
    expect(numeric.win_count).toBe(1)

    const malformed = calculatePNLSummary(
      [trade({ realized_pnl: 'not-a-number' as unknown as number })],
      'all'
    )
    expect(malformed.total_pnl).toBeNaN()
    expect(malformed.win_count).toBe(0)
    expect(malformed.loss_count).toBe(0)
  })
})

describe('buildPNLTimeSeries', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('places pnl on the local hour and drops trades outside the 24 hour window', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(FROZEN_NOW))

    const inside = FROZEN_NOW
    const outside = '2026-06-14T09:00:00.000Z'
    const points = buildPNLTimeSeries(
      [
        trade({ id: 'inside', external_trade_id: 'inside', realized_pnl: 4.5, traded_at: inside }),
        trade({ id: 'outside', external_trade_id: 'outside', realized_pnl: 99, traded_at: outside }),
        trade({ id: 'open', external_trade_id: 'open', realized_pnl: null, traded_at: inside }),
      ],
      'day'
    )

    expect(points).toHaveLength(24)
    const hit = points.filter((point) => point.pnl !== 0)
    expect(hit).toEqual([
      {
        date: localHourKey(inside),
        pnl: 4.5,
        cumulative_pnl: 4.5,
      },
    ])
    expect(localHourKey(inside)).toBe('2026-06-15 17:00')
    expect(new Date(inside).getUTCHours()).toBe(10)
  })

  it('uses the local calendar day across a UTC date boundary', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-02T02:00:00.000Z'))
    const tradedAt = '2026-01-01T20:30:00.000Z'

    expect(new Date(tradedAt).getUTCDate()).toBe(1)
    expect(localDayKey(tradedAt)).toBe('2026-01-02')

    const points = buildPNLTimeSeries(
      [trade({ realized_pnl: 7, traded_at: tradedAt })],
      'week'
    )
    const hit = points.filter((point) => point.pnl !== 0)
    expect(hit).toHaveLength(1)
    expect(hit[0]?.date).toBe('2026-01-02')
    expect(hit[0]?.pnl).toBe(7)
    expect(points).toHaveLength(7)
  })

  it('ignores a missing or unparseable traded_at', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(FROZEN_NOW))

    const points = buildPNLTimeSeries(
      [
        trade({ id: 'bad', external_trade_id: 'bad', realized_pnl: 5, traded_at: 'not-a-date' }),
        trade({ id: 'empty', external_trade_id: 'empty', realized_pnl: 6, traded_at: '' }),
      ],
      'month'
    )

    expect(points.every((point) => point.pnl === 0)).toBe(true)
    expect(points).toHaveLength(30)
  })

  it('accumulates local month buckets for the year range', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(FROZEN_NOW))

    const points = buildPNLTimeSeries(
      [trade({ realized_pnl: 1.234567895, traded_at: FROZEN_NOW })],
      'year'
    )

    expect(points).toHaveLength(12)
    const june = points.find((point) => point.date === '2026-06')
    expect(june?.pnl).toBe(parseFloat((1.234567895).toFixed(8)))
    expect(june?.cumulative_pnl).toBe(june?.pnl)
  })
})

describe('calendar buckets', () => {
  it('builds every local day in the month and rounds pnl to 4 decimal places', () => {
    const days = buildPNLCalendarDays(
      [
        trade({ realized_pnl: 1.23456, traded_at: '2026-06-15T10:30:00.000Z' }),
        trade({
          id: 'other',
          external_trade_id: 'other',
          realized_pnl: 1,
          traded_at: '2026-06-15T18:30:00.000Z',
        }),
        trade({
          id: 'open',
          external_trade_id: 'open',
          realized_pnl: null,
          traded_at: '2026-06-15T10:30:00.000Z',
        }),
      ],
      2026,
      6
    )

    expect(days).toHaveLength(30)
    expect(days[14]).toEqual({ date: '2026-06-15', pnl: 1.2346, tradeCount: 1 })
    expect(days[15]).toEqual({ date: '2026-06-16', pnl: 1, tradeCount: 1 })
    expect(days[0]?.pnl).toBe(0)
    expect(days[0]?.tradeCount).toBe(0)
  })

  it('uses the local length of February', () => {
    expect(buildPNLCalendarDays([], 2024, 2)).toHaveLength(29)
    expect(buildPNLCalendarDays([], 2025, 2)).toHaveLength(28)
  })

  it('sums months in the requested local year only', () => {
    const months = buildPNLCalendarMonths(
      [
        trade({ realized_pnl: 2.5, traded_at: '2026-06-15T10:30:00.000Z' }),
        trade({
          id: 'prior',
          external_trade_id: 'prior',
          realized_pnl: 99,
          traded_at: '2025-12-31T10:00:00.000Z',
        }),
      ],
      2026
    )

    expect(months).toHaveLength(12)
    expect(months[5]).toEqual({ year: 2026, month: 6, pnl: 2.5, tradeCount: 1 })
    expect(months.filter((month) => month.month !== 6).every((month) => month.pnl === 0)).toBe(true)
  })
})

describe('getDateRangeForPeriod', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns a local rolling window ending at the current instant', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(FROZEN_NOW))

    const endDate = new Date(FROZEN_NOW).toISOString()
    const dayStart = new Date(FROZEN_NOW)
    dayStart.setHours(0, 0, 0, 0)
    const weekStart = new Date(FROZEN_NOW)
    weekStart.setDate(weekStart.getDate() - 7)
    const monthStart = new Date(FROZEN_NOW)
    monthStart.setDate(monthStart.getDate() - 30)
    const yearStart = new Date(FROZEN_NOW)
    yearStart.setFullYear(yearStart.getFullYear() - 1)

    expect(getDateRangeForPeriod('day')).toEqual({
      startDate: dayStart.toISOString(),
      endDate,
    })
    expect(getDateRangeForPeriod('week')).toEqual({
      startDate: weekStart.toISOString(),
      endDate,
    })
    expect(getDateRangeForPeriod('month')).toEqual({
      startDate: monthStart.toISOString(),
      endDate,
    })
    expect(getDateRangeForPeriod('year')).toEqual({
      startDate: yearStart.toISOString(),
      endDate,
    })
    expect(getDateRangeForPeriod('day').startDate).toBe('2026-06-14T17:00:00.000Z')
    expect(getDateRangeForPeriod('year').startDate).toBe('2025-06-15T10:30:00.000Z')
  })

  it('leaves startDate unset for an unknown range', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(FROZEN_NOW))

    const range = getDateRangeForPeriod('nope' as 'day')
    expect(range.endDate).toBe(FROZEN_NOW)
    expect(range.startDate).toBeUndefined()
  })
})
