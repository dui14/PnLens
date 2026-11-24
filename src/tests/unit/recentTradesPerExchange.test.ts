import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchRecentTradesPerExchange } from '@/lib/services/pnlService'
import { RECENT_TRADES_PER_EXCHANGE_LIMIT } from '@/lib/config/recentTrades'
import { EXCHANGES } from '@/lib/types'

const getExchangeAccountById = vi.hoisted(() => vi.fn())
const getTrades = vi.hoisted(() => vi.fn())

vi.mock('@/lib/db/exchangeDb', () => ({
  getExchangeAccountById: (...args: unknown[]) => getExchangeAccountById(...args),
}))

vi.mock('@/lib/db/tradesDb', () => ({
  getTrades: (...args: unknown[]) => getTrades(...args),
  getTradesForPNL: vi.fn(),
  getTradeTotals: vi.fn(),
}))

function trade(id: string, exchange: string, tradedAt: string) {
  return { id, exchange, traded_at: tradedAt }
}

describe('fetchRecentTradesPerExchange', () => {
  beforeEach(() => {
    getExchangeAccountById.mockReset()
    getTrades.mockReset()
  })

  it('queries each exchange with the per-exchange limit and merges by time desc', async () => {
    getTrades.mockImplementation(async (_s: unknown, _u: unknown, options: { exchange: string }) => ({
      trades:
        options.exchange === 'okx'
          ? [trade('o1', 'okx', '2026-01-03T00:00:00Z'), trade('o2', 'okx', '2026-01-01T00:00:00Z')]
          : options.exchange === 'binance'
            ? [trade('b1', 'binance', '2026-01-02T00:00:00Z')]
            : [],
      nextCursor: null,
    }))

    const result = await fetchRecentTradesPerExchange({} as never, 'user-a', { segment: 'spot', executedOnly: true })

    expect(getTrades).toHaveBeenCalledTimes(EXCHANGES.length)
    for (const call of getTrades.mock.calls) {
      expect(call[2]).toMatchObject({ limit: RECENT_TRADES_PER_EXCHANGE_LIMIT, tradeType: 'spot', executedOnly: true })
    }
    expect(result.success && result.data.map((t) => t.id)).toEqual(['o1', 'b1', 'o2'])
  })

  it('queries only the requested exchange', async () => {
    getTrades.mockResolvedValue({ trades: [], nextCursor: null })
    await fetchRecentTradesPerExchange({} as never, 'user-a', { exchange: 'bybit' })
    expect(getTrades).toHaveBeenCalledTimes(1)
    expect(getTrades.mock.calls[0][2]).toMatchObject({ exchange: 'bybit', limit: RECENT_TRADES_PER_EXCHANGE_LIMIT })
  })

  it('refuses an account the user does not own', async () => {
    getExchangeAccountById.mockResolvedValue(null)
    const result = await fetchRecentTradesPerExchange({} as never, 'user-a', { exchangeAccountId: 'x' })
    expect(result).toEqual({ success: false, error: 'NOT_FOUND' })
    expect(getTrades).not.toHaveBeenCalled()
  })
})
