import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ExchangeWindowError } from '@/lib/adapters/exchangeWindowError'
import type { ExchangeAdapterTrade } from '@/lib/types'
import { buildScanWindows } from '@/lib/scan/scanLimits'
import { runScan } from '@/lib/scan/runScan'

const state = vi.hoisted(() => ({
  account: {
    id: 'account-1',
    user_id: 'user-1',
    exchange: 'binance' as const,
    label: null,
    is_active: true,
    sync_status: 'syncing' as const,
    sync_error: null,
    sync_started_at: '2026-06-01T00:00:00.000Z',
    last_synced: null as string | null,
    created_at: '2026-01-01T00:00:00.000Z',
  },
  statuses: [] as string[],
  lastSynced: 0,
  upserts: [] as ExchangeAdapterTrade[][],
  rejected: { INVALID_TIMESTAMP: 0, INVALID_NUMBER: 0, MISSING_ID: 0 },
}))

const fetchTrades = vi.hoisted(() => vi.fn())

vi.mock('@/lib/db/exchangeDb', () => ({
  getExchangeAccountByAccountId: vi.fn(async () => state.account),
  getApiKey: vi.fn(async () => ({
    key_encrypted: 'key',
    key_iv: 'iv',
    secret_encrypted: 'secret',
    secret_iv: 'iv',
    passphrase_encrypted: null,
    passphrase_iv: null,
    proxy_encrypted: 'http://user-proxy.example:8080',
    proxy_iv: 'iv',
  })),
  updateSyncStatus: vi.fn(async (_client: unknown, _id: string, status: string, error: string | null) => {
    state.statuses.push(`${status}:${error}`)
  }),
  updateLastSynced: vi.fn(async () => {
    state.lastSynced += 1
  }),
}))

vi.mock('@/lib/adapters/encryption', () => ({
  decrypt: (value: string) => value,
}))

vi.mock('@/lib/db/tradesDb', () => ({
  upsertTrades: vi.fn(async (_client: unknown, _accountId: string, _userId: string, trades: ExchangeAdapterTrade[]) => {
    state.upserts.push(trades)
    return trades.length
  }),
}))

vi.mock('@/lib/adapters/exchangeFactory', () => ({
  createExchangeAdapter: vi.fn(async () => ({
    fetchTrades,
    rejectedTradeCounts: () => ({ ...state.rejected }),
  })),
}))

function fill(id: string): ExchangeAdapterTrade {
  return {
    external_trade_id: id,
    symbol: 'BTCUSDT',
    side: 'buy',
    quantity: '1',
    price: '2',
    fee: '0',
    fee_currency: 'USDT',
    realized_pnl: null,
    trade_type: 'spot',
    traded_at: '2026-05-01T00:00:00.000Z',
    raw_data: {},
  }
}

const limits = { maxLookbackDays: 2, windowDays: 1, pageSize: 100 }
const now = new Date('2026-06-01T00:00:00.000Z')

describe('runScan', () => {
  beforeEach(() => {
    state.statuses = []
    state.lastSynced = 0
    state.upserts = []
    state.rejected = { INVALID_TIMESTAMP: 0, INVALID_NUMBER: 0, MISSING_ID: 0 }
    state.account.last_synced = null
    fetchTrades.mockReset()
  })

  it('keeps earlier windows when a later window fails and does not move last_synced', async () => {
    fetchTrades.mockResolvedValueOnce([fill('spot_1')]).mockRejectedValueOnce(new ExchangeWindowError())

    const result = await runScan('account-1', { now, client: {} as never, limits })

    expect(result.sync_status).toBe('error')
    expect(result.sync_error).toBe('EXCHANGE_ERROR')
    expect(state.upserts).toEqual([[fill('spot_1')]])
    expect(state.lastSynced).toBe(0)
    expect(state.statuses).toEqual(['error:EXCHANGE_ERROR'])
  })

  it('records a rejected row and still finishes the scan', async () => {
    state.rejected = { INVALID_TIMESTAMP: 0, INVALID_NUMBER: 1, MISSING_ID: 0 }
    fetchTrades.mockResolvedValue([fill('spot_1')])

    const result = await runScan('account-1', {
      now,
      client: {} as never,
      limits: { maxLookbackDays: 2, windowDays: null, pageSize: 100 },
    })

    expect(result.sync_status).toBe('synced')
    expect(result.rejected.INVALID_NUMBER).toBe(1)
    expect(result.sync_error).toBe('ROWS_SKIPPED:1')
    expect(state.lastSynced).toBe(1)
    expect(fetchTrades.mock.calls[0]?.[0]).toEqual({ apiKey: 'key', apiSecret: 'secret', passphrase: undefined })
  })

  it('fails a window whose rows are all rejected without deleting earlier rows', async () => {
    fetchTrades.mockResolvedValueOnce([fill('spot_1')]).mockResolvedValueOnce([])
    state.rejected = { INVALID_TIMESTAMP: 2, INVALID_NUMBER: 0, MISSING_ID: 0 }

    const result = await runScan('account-1', { now, client: {} as never, limits })

    expect(result.sync_error).toBe('WINDOW_REJECTED')
    expect(state.upserts).toHaveLength(1)
    expect(state.lastSynced).toBe(0)
  })

  it('stores EXCHANGE_ERROR after HTTP 500 and succeeds on the next scan', async () => {
    fetchTrades.mockRejectedValueOnce(new ExchangeWindowError())
    const failed = await runScan('account-1', {
      now,
      client: {} as never,
      limits: { maxLookbackDays: 1, windowDays: null, pageSize: 1000 },
    })
    expect(failed.sync_error).toBe('EXCHANGE_ERROR')
    expect(state.lastSynced).toBe(0)

    state.rejected = { INVALID_TIMESTAMP: 0, INVALID_NUMBER: 0, MISSING_ID: 0 }
    fetchTrades.mockResolvedValueOnce([fill('spot_2')])
    const succeeded = await runScan('account-1', {
      now,
      client: {} as never,
      limits: { maxLookbackDays: 1, windowDays: null, pageSize: 1000 },
    })
    expect(succeeded.sync_status).toBe('synced')
    expect(state.lastSynced).toBe(1)
    expect(state.upserts).toEqual([[fill('spot_2')]])
  })
})

describe('buildScanWindows', () => {
  it('warns when last_synced is older than a known maximum', () => {
    const plan = buildScanWindows({
      now,
      lastSynced: '2024-01-01T00:00:00.000Z',
      limits: { maxLookbackDays: 90, windowDays: null, pageSize: null },
    })
    expect(plan.warnings).toContain('COVERAGE_GAP')
    expect(plan.windows[0]?.start.toISOString()).toBe(new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString())
  })

  it('warns when the guide has no maximum and still requests one year', () => {
    const plan = buildScanWindows({
      now,
      lastSynced: null,
      limits: { maxLookbackDays: null, windowDays: null, pageSize: 1000 },
    })
    expect(plan.warnings).toEqual(['LOOKBACK_UNVERIFIED'])
    expect(plan.windows).toHaveLength(1)
  })
})
