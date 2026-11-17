import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchPaginatedTrades } from '@/lib/services/pnlService'

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

describe('pnl account scope', () => {
  beforeEach(() => {
    getExchangeAccountById.mockReset()
    getTrades.mockReset()
  })

  it('refuses another user account trades', async () => {
    getExchangeAccountById.mockResolvedValue(null)

    const result = await fetchPaginatedTrades({} as never, 'user-a', {
      limit: 20,
      exchangeAccountId: 'account-b',
    })

    expect(result).toEqual({ success: false, error: 'NOT_FOUND' })
    expect(getTrades).not.toHaveBeenCalled()
  })

  it('reads the owner account with the requested page', async () => {
    getExchangeAccountById.mockResolvedValue({ id: 'account-a', user_id: 'user-a' })
    getTrades.mockResolvedValue({ trades: [], nextCursor: null })

    const result = await fetchPaginatedTrades({} as never, 'user-a', {
      cursor: { tradedAt: '2026-01-01T00:00:00.000Z', id: 'c1' },
      limit: 20,
      exchangeAccountId: 'account-a',
    })

    expect(result.success).toBe(true)
    expect(getTrades).toHaveBeenCalledWith(
      expect.anything(),
      'user-a',
      expect.objectContaining({ limit: 20, exchangeAccountId: 'account-a' })
    )
  })
})
