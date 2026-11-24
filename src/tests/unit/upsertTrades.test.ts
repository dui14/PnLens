import { describe, expect, it } from 'vitest'
import { upsertTrades } from '@/lib/db/tradesDb'
import type { ExchangeAdapterTrade } from '@/lib/types'

function trade(id: string): ExchangeAdapterTrade {
  return {
    external_trade_id: id,
    symbol: 'BTCUSDT',
    side: 'buy',
    quantity: '1.2500',
    price: '65000.10',
    fee: '0.0100',
    fee_currency: 'USDT',
    realized_pnl: null,
    trade_type: 'spot',
    traded_at: '2026-01-01T00:00:00.000Z',
    raw_data: { id },
  }
}

function memoryTrades() {
  const rows = new Map<string, Record<string, unknown>>()
  return {
    rows,
    from() {
      return {
        upsert(batch: Array<Record<string, string>>) {
          const inserted: Array<{ id: string }> = []
          for (const row of batch) {
            const key = `${row.exchange_account_id}:${row.external_trade_id}`
            if (rows.has(key)) continue
            rows.set(key, row)
            inserted.push({ id: key })
          }
          return {
            select: () => Promise.resolve({ data: inserted, error: null }),
          }
        },
      }
    },
  }
}

describe('upsertTrades', () => {
  it('keeps one row when the same external trade id is upserted twice', async () => {
    const supabase = memoryTrades()
    const first = await upsertTrades(supabase as never, 'account-1', 'user-1', [trade('spot_1')])
    const second = await upsertTrades(supabase as never, 'account-1', 'user-1', [trade('spot_1'), trade('spot_2')])
    expect(first).toBe(1)
    expect(second).toBe(1)
    expect(supabase.rows.size).toBe(2)
    expect(supabase.rows.get('account-1:spot_1')).toMatchObject({ quantity: '1.2500', price: '65000.10' })
  })
})
