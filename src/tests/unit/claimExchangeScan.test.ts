import { describe, expect, it } from 'vitest'
import { claimExchangeScan } from '@/lib/db/exchangeDb'

type AccountRow = {
  id: string
  user_id: string
  exchange: 'binance'
  label: null
  is_active: boolean
  sync_status: string
  sync_error: string | null
  sync_started_at: string | null
  last_synced: string | null
  created_at: string
}

function memoryAccounts(initial: AccountRow | null) {
  const state = { row: initial ? { ...initial } : null }
  return {
    state,
    from() {
      const query: { id?: string; userId?: string; update?: Record<string, unknown>; orFilter?: string } = {}
      const builder = {
        select() {
          return builder
        },
        eq(column: string, value: unknown) {
          if (column === 'id') query.id = String(value)
          if (column === 'user_id') query.userId = String(value)
          return builder
        },
        neq() {
          return builder
        },
        or(filter: string) {
          query.orFilter = filter
          return builder
        },
        update(payload: Record<string, unknown>) {
          query.update = payload
          return builder
        },
        single() {
          return Promise.resolve(read())
        },
        maybeSingle() {
          return Promise.resolve(read())
        },
        then(onFulfilled?: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) {
          return Promise.resolve(write()).then(onFulfilled, onRejected)
        },
      }

      function matches(row: AccountRow): boolean {
        if (query.id && row.id !== query.id) return false
        if (query.userId && row.user_id !== query.userId) return false
        return true
      }

      function read() {
        const row = state.row
        if (!row || !matches(row)) return { data: null, error: { message: 'missing' } }
        return { data: { ...row }, error: null }
      }

      function write() {
        const row = state.row
        if (!row || !matches(row) || !row.is_active) return { data: [], error: null }
        const cutoff = query.orFilter?.match(/last_synced\.lte\."([^"]+)"/)?.[1]
        const coolingDown = Boolean(row.last_synced && cutoff && row.last_synced > cutoff)
        if (row.sync_status === 'syncing' || coolingDown) return { data: [], error: null }
        Object.assign(row, query.update)
        return { data: [{ id: row.id }], error: null }
      }

      return builder
    },
  }
}

const now = '2026-06-01T00:00:00.000Z'
const cooldownBefore = '2026-05-31T23:55:00.000Z'
const staleBefore = '2026-05-31T23:30:00.000Z'

function row(overrides: Partial<AccountRow> = {}): AccountRow {
  return {
    id: 'account-1',
    user_id: 'user-1',
    exchange: 'binance',
    label: null,
    is_active: true,
    sync_status: 'pending',
    sync_error: null,
    sync_started_at: null,
    last_synced: null,
    created_at: now,
    ...overrides,
  }
}

describe('claimExchangeScan', () => {
  it('lets the first claim start a scan and refuses the second click', async () => {
    const supabase = memoryAccounts(row())
    const first = await claimExchangeScan(supabase as never, 'account-1', 'user-1', now, cooldownBefore, staleBefore)
    const second = await claimExchangeScan(supabase as never, 'account-1', 'user-1', now, cooldownBefore, staleBefore)
    expect(first).toBe('claimed')
    expect(second).toBe('in_progress')
    expect(supabase.state.row?.sync_status).toBe('syncing')
    expect(supabase.state.row?.sync_started_at).toBe(now)
  })

  it('refuses an account owned by someone else', async () => {
    const supabase = memoryAccounts(row({ user_id: 'user-2' }))
    const result = await claimExchangeScan(supabase as never, 'account-1', 'user-1', now, cooldownBefore, staleBefore)
    expect(result).toBe('not_found')
    expect(supabase.state.row?.sync_status).toBe('pending')
  })
})
