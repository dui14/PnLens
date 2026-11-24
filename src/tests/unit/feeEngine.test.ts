import { describe, expect, it } from 'vitest'
import type { Trade } from '@/lib/types'
import { buildFeeSummary, convertFeeToUsd, filterFeeRows, sumFeeRows } from '@/lib/engines/feeEngine'
import type { TradeWithExchange } from '@/lib/engines/pnlSnapshotEngine'

function trade(overrides: Partial<TradeWithExchange> = {}): TradeWithExchange {
  const base: Trade = {
    id: 't1',
    exchange_account_id: 'a1',
    user_id: 'u1',
    external_trade_id: 'e1',
    symbol: 'BTCUSDT',
    side: 'buy',
    quantity: 2,
    price: 100,
    fee: 0.5,
    fee_currency: 'USDT',
    realized_pnl: null,
    funding_fee: 0,
    income_type: null,
    trade_type: 'spot',
    traded_at: '2026-01-01T00:00:00.000Z',
    raw_data: null,
    created_at: '2026-01-01T00:00:00.000Z',
  }
  return { ...base, exchange: 'binance', ...overrides }
}

describe('convertFeeToUsd', () => {
  it('keeps USD-like fees as is', () => {
    expect(convertFeeToUsd(trade({ fee: 1.5, fee_currency: 'usdt' }))).toBe(1.5)
    expect(convertFeeToUsd(trade({ fee: 1.5, fee_currency: null }))).toBe(1.5)
  })

  it('converts base-asset fees with the trade price', () => {
    expect(convertFeeToUsd(trade({ fee: 0.001, fee_currency: 'BTC', price: 50000 }))).toBe(50)
  })

  it('returns null for fees that cannot be converted', () => {
    expect(convertFeeToUsd(trade({ fee: 0.1, fee_currency: 'BNB' }))).toBeNull()
  })

  it('treats negative fees as absolute and zero as zero', () => {
    expect(convertFeeToUsd(trade({ fee: -0.2 }))).toBe(0.2)
    expect(convertFeeToUsd(trade({ fee: 0, fee_currency: 'BNB' }))).toBe(0)
  })
})

describe('buildFeeSummary', () => {
  const trades = [
    trade({ id: '1' }),
    trade({ id: '2', fee: 1 }),
    trade({ id: '3', exchange: 'okx', trade_type: 'futures', quantity: 10, price: 10, fee: 2 }),
    trade({ id: '4', exchange: 'okx', trade_type: 'futures', fee: 1, fee_currency: 'OKB' }),
    trade({ id: '5', trade_type: 'margin' }),
    trade({ id: '6', quantity: 0 }),
    trade({ id: '7', exchange: undefined }),
  ]

  it('groups by exchange and trade type', () => {
    const summary = buildFeeSummary(trades)
    expect(summary.rows).toHaveLength(2)
    const binance = summary.rows.find((row) => row.exchange === 'binance')
    expect(binance).toMatchObject({ tradeType: 'spot', feeUsd: 1.5, volumeUsd: 400, tradeCount: 2 })
    const okx = summary.rows.find((row) => row.exchange === 'okx')
    expect(okx).toMatchObject({ tradeType: 'futures', feeUsd: 2, volumeUsd: 300, tradeCount: 2 })
  })

  it('sums mixed-sign fees as absolute fee paid', () => {
    const summary = buildFeeSummary([
      trade({ id: 'a', exchange: 'bitget', trade_type: 'futures', fee: -0.63 }),
      trade({ id: 'b', exchange: 'bitget', trade_type: 'futures', fee: 0.37 }),
      trade({ id: 'c', exchange: 'bitget', trade_type: 'futures', fee: -1 }),
    ])
    expect(summary.rows).toHaveLength(1)
    expect(summary.rows[0].feeUsd).toBe(2)
  })

  it('counts unconvertible fees', () => {
    expect(buildFeeSummary(trades).unconvertedCount).toBe(1)
  })

  it('returns empty rows without trades', () => {
    expect(buildFeeSummary([])).toEqual({ rows: [], unconvertedCount: 0 })
  })
})

describe('filterFeeRows and sumFeeRows', () => {
  const { rows } = buildFeeSummary([
    trade({ id: '1' }),
    trade({ id: '2', exchange: 'okx', trade_type: 'futures', fee: 2 }),
  ])

  it('filters by exchange and type', () => {
    expect(filterFeeRows(rows, { exchange: 'all', tradeType: 'all' })).toHaveLength(2)
    expect(filterFeeRows(rows, { exchange: 'okx', tradeType: 'all' })).toHaveLength(1)
    expect(filterFeeRows(rows, { exchange: 'okx', tradeType: 'spot' })).toHaveLength(0)
  })

  it('sums rows', () => {
    expect(sumFeeRows(rows)).toEqual({ feeUsd: 2.5, volumeUsd: 400, tradeCount: 2 })
  })
})

describe('non-USD quoted symbols', () => {
  it('counts a USDT/VND trade volume in USDT, not VND', () => {
    const vnd = trade({ symbol: 'USDTVND', quantity: 100, price: 26000, fee: -2600, fee_currency: 'VND' })
    const summary = buildFeeSummary([vnd])
    expect(summary.rows[0]?.volumeUsd).toBe(100)
    expect(convertFeeToUsd(vnd)).toBeCloseTo(0.1)
    expect(summary.unconvertedCount).toBe(0)
  })

  it('excludes volume and fee that cannot be converted to USD', () => {
    const odd = trade({ symbol: 'BTCVND', quantity: 1, price: 2_000_000_000, fee: 5, fee_currency: 'VND' })
    const summary = buildFeeSummary([odd])
    expect(summary.rows[0]?.volumeUsd).toBe(0)
    expect(summary.unconvertedCount).toBe(1)
  })
})
