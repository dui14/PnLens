import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Trade } from '@/lib/types'
import { EXCHANGES, SNAPSHOT_EXCHANGES, TRADE_SEGMENTS } from '@/lib/types'
import {
  buildPnlCalendarHistory,
  buildPnlSnapshotPayload,
  buildPnlSnapshotRows,
  filterTradesForSnapshot,
  type TradeWithExchange,
} from '@/lib/engines/pnlSnapshotEngine'

const FROZEN_NOW = new Date('2026-06-15T10:30:00.000Z')
const EXPECTED_COMBOS = TRADE_SEGMENTS.length * (EXCHANGES.length + 1)

function trade(overrides: Partial<TradeWithExchange> = {}): TradeWithExchange {
  const base: Trade = {
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
    realized_pnl: 10,
    funding_fee: 0,
    income_type: null,
    trade_type: 'futures',
    traded_at: FROZEN_NOW.toISOString(),
    raw_data: null,
    created_at: FROZEN_NOW.toISOString(),
  }
  return { ...base, exchange: 'okx', ...overrides }
}

const fixtures: TradeWithExchange[] = [
  trade({ id: 'a', exchange: 'okx', trade_type: 'futures', realized_pnl: 10, traded_at: '2026-06-15T03:00:00.000Z' }),
  trade({ id: 'b', exchange: 'okx', trade_type: 'spot', realized_pnl: -4, traded_at: '2026-06-15T05:00:00.000Z' }),
  trade({ id: 'c', exchange: 'binance', trade_type: 'spot', realized_pnl: 6, traded_at: '2026-05-20T05:00:00.000Z' }),
  trade({ id: 'd', exchange: 'gateio', trade_type: 'futures', realized_pnl: null, traded_at: '2025-12-31T05:00:00.000Z' }),
]

afterEach(() => {
  vi.useRealTimers()
})

describe('filterTradesForSnapshot', () => {
  it('keeps everything for all/all', () => {
    expect(filterTradesForSnapshot(fixtures, 'all', 'all')).toHaveLength(fixtures.length)
  })

  it('filters by segment', () => {
    const ids = filterTradesForSnapshot(fixtures, 'spot', 'all').map((t) => t.id)
    expect(ids).toEqual(['b', 'c'])
  })

  it('filters by exchange', () => {
    const ids = filterTradesForSnapshot(fixtures, 'all', 'okx').map((t) => t.id)
    expect(ids).toEqual(['a', 'b'])
  })

  it('filters by segment and exchange together', () => {
    const ids = filterTradesForSnapshot(fixtures, 'futures', 'okx').map((t) => t.id)
    expect(ids).toEqual(['a'])
  })
})

describe('buildPnlCalendarHistory', () => {
  it('buckets daily and monthly pnl across all history sorted ascending', () => {
    const calendar = buildPnlCalendarHistory(fixtures)
    expect(calendar.days).toEqual([
      { date: '2026-05-20', pnl: 6, tradeCount: 1 },
      { date: '2026-06-15', pnl: 6, tradeCount: 2 },
    ])
    expect(calendar.months).toEqual([
      { year: 2026, month: 5, pnl: 6, tradeCount: 1 },
      { year: 2026, month: 6, pnl: 6, tradeCount: 2 },
    ])
  })

  it('returns empty buckets without trades', () => {
    expect(buildPnlCalendarHistory([])).toEqual({ days: [], months: [] })
  })
})

describe('buildPnlSnapshotRows', () => {
  it('builds every segment by exchange combination exactly once', () => {
    vi.useFakeTimers()
    vi.setSystemTime(FROZEN_NOW)
    const rows = buildPnlSnapshotRows(fixtures, FROZEN_NOW)
    expect(rows).toHaveLength(EXPECTED_COMBOS)
    const keys = new Set(rows.map((row) => `${row.segment}:${row.exchange}`))
    expect(keys.size).toBe(EXPECTED_COMBOS)
    for (const segment of TRADE_SEGMENTS) {
      for (const exchange of SNAPSHOT_EXCHANGES) {
        expect(keys.has(`${segment}:${exchange}`)).toBe(true)
      }
    }
  })

  it('sets trade_count and pnl per combination', () => {
    vi.useFakeTimers()
    vi.setSystemTime(FROZEN_NOW)
    const rows = buildPnlSnapshotRows(fixtures, FROZEN_NOW)
    const find = (segment: string, exchange: string) =>
      rows.find((row) => row.segment === segment && row.exchange === exchange)

    expect(find('all', 'all')?.trade_count).toBe(fixtures.length)
    expect(find('spot', 'okx')?.trade_count).toBe(1)
    expect(find('spot', 'okx')?.payload.overview.pnl.all).toBe(-4)
    expect(find('futures', 'bybit')?.trade_count).toBe(0)
    expect(find('futures', 'bybit')?.payload.calendar.days).toEqual([])
  })
})

describe('buildPnlSnapshotPayload', () => {
  it('includes overview, all chart ranges, calendar and assets', () => {
    vi.useFakeTimers()
    vi.setSystemTime(FROZEN_NOW)
    const payload = buildPnlSnapshotPayload(fixtures, FROZEN_NOW)
    expect(Object.keys(payload.chart).sort()).toEqual(['day', 'month', 'week', 'year'])
    expect(payload.chart.day).toHaveLength(24)
    expect(payload.overview.pnl.today).toBe(6)
    expect(payload.overview.pnl.all).toBe(12)
    expect(payload.overview.totalTrades.count).toBe(fixtures.length)
    expect(payload.assets.items.length).toBeGreaterThan(0)
  })
})

describe('snapshot fee conversion', () => {
  it('converts a VND fee on a USDT/VND row to USD instead of counting it as USD', () => {
    vi.useFakeTimers()
    vi.setSystemTime(FROZEN_NOW)
    const vnd = trade({
      id: 'vnd',
      exchange: 'bitget',
      trade_type: 'spot',
      symbol: 'USDTVND',
      quantity: 100,
      price: 26000,
      fee: -2600,
      fee_currency: 'VND',
      realized_pnl: null,
    })
    const rows = buildPnlSnapshotRows([vnd], FROZEN_NOW)
    const row = rows.find((item) => item.segment === 'all' && item.exchange === 'bitget')
    expect(row?.payload.fees?.totals.year.feeUsd).toBeCloseTo(0.1)
    expect(row?.payload.fees?.totals.year.volumeUsd).toBe(100)
  })
})
