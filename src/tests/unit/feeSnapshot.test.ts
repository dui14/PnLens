import { describe, expect, it } from 'vitest'
import type { Trade } from '@/lib/types'
import { PNL_PERIODS } from '@/lib/types'
import { buildFeeDailySeries, buildPnlSnapshotFees } from '@/lib/engines/feeSnapshotEngine'
import { buildDashboardOverview, buildPnlSnapshotPayload, type TradeWithExchange } from '@/lib/engines/pnlSnapshotEngine'

const NOW = new Date('2026-06-15T05:00:00.000Z')

function trade(overrides: Partial<TradeWithExchange> = {}): TradeWithExchange {
  const base: Trade = {
    id: 't1',
    exchange_account_id: 'a1',
    user_id: 'u1',
    external_trade_id: 'e1',
    symbol: 'BTCUSDT',
    side: 'buy',
    quantity: 1,
    price: 100,
    fee: 1,
    fee_currency: 'USDT',
    realized_pnl: null,
    funding_fee: 0,
    income_type: null,
    trade_type: 'spot',
    traded_at: '2026-06-15T01:00:00.000Z',
    raw_data: null,
    created_at: '2026-06-15T01:00:00.000Z',
  }
  return { ...base, exchange: 'binance', ...overrides }
}

const trades: TradeWithExchange[] = [
  trade({ id: '1', traded_at: '2026-06-15T01:00:00.000Z' }),
  trade({ id: '2', exchange: 'okx', trade_type: 'futures', fee: 2, traded_at: '2026-06-10T01:00:00.000Z' }),
  trade({ id: '3', fee: 3, traded_at: '2026-05-01T01:00:00.000Z' }),
  trade({ id: '4', fee: 4, traded_at: '2026-03-01T01:00:00.000Z' }),
  trade({ id: '5', fee: 5, traded_at: '2026-01-10T01:00:00.000Z' }),
  trade({ id: '6', fee: 9, traded_at: '2025-01-10T01:00:00.000Z' }),
  trade({ id: '7', fee: 0.1, fee_currency: 'BNB', traded_at: '2026-06-15T02:00:00.000Z' }),
]

describe('buildPnlSnapshotFees', () => {
  const fees = buildPnlSnapshotFees(trades, NOW)

  it('covers every period key', () => {
    expect(Object.keys(fees.periods).sort()).toEqual([...PNL_PERIODS].sort())
    expect(Object.keys(fees.totals).sort()).toEqual([...PNL_PERIODS].sort())
  })

  it('totals fee and volume per period', () => {
    expect(fees.totals.today.feeUsd).toBe(1)
    expect(fees.totals.d7.feeUsd).toBe(3)
    expect(fees.totals.d30.feeUsd).toBe(3)
    expect(fees.totals.d90.feeUsd).toBe(6)
    expect(fees.totals.year.feeUsd).toBe(15)
    expect(fees.totals.year.volumeUsd).toBe(600)
  })

  it('splits per exchange and trade type and counts unconverted fees', () => {
    const d7 = fees.periods.d7
    expect(d7.rows.map((r) => `${r.exchange}:${r.tradeType}`).sort()).toEqual(['binance:spot', 'okx:futures'])
    expect(d7.unconvertedCount).toBe(1)
    expect(fees.periods.d30.unconvertedCount).toBe(1)
    expect(fees.periods.d90.unconvertedCount).toBe(1)
  })
})

describe('buildFeeDailySeries', () => {
  it('buckets by UTC+7 day, exchange and trade type, sorted, within one year', () => {
    const series = buildFeeDailySeries(trades, NOW)
    expect(series.some((p) => p.date < '2025-06-15')).toBe(false)
    expect(series[0].date).toBe('2026-01-10')
    const today = series.filter((p) => p.date === '2026-06-15')
    expect(today).toEqual([{ date: '2026-06-15', exchange: 'binance', tradeType: 'spot', feeUsd: 1, volumeUsd: 200 }])
    const dates = series.map((p) => p.date)
    expect([...dates].sort()).toEqual(dates)
  })

  it('merges trades from the same day', () => {
    const series = buildFeeDailySeries(
      [trade({ id: 'a' }), trade({ id: 'b', fee: 2, traded_at: '2026-06-15T03:00:00.000Z' })],
      NOW
    )
    expect(series).toHaveLength(1)
    expect(series[0].feeUsd).toBe(3)
    expect(series[0].volumeUsd).toBe(200)
  })
})

describe('snapshot payload', () => {
  it('includes fees and volume for all periods', () => {
    const payload = buildPnlSnapshotPayload(trades, NOW)
    expect(payload.fees?.totals.today.feeUsd).toBe(1)
    const tt = buildDashboardOverview(trades, NOW).totalTrades
    expect(tt.volumeUsdToday).toBe(200)
    expect(tt.volumeUsdYear).toBe(600)
    expect(tt.volumeUsdD7).toBe(300)
  })
})
