import { beforeEach, describe, expect, it, vi } from 'vitest'

const account = { id: 'acc-1', user_id: 'user-1', is_active: true }

const db = vi.hoisted(() => ({
  getExchangeAccountById: vi.fn(),
  updateExchangeActive: vi.fn(),
  deleteExchangeAccount: vi.fn(),
}))

const serviceClient = vi.hoisted(() => ({ tag: 'service', from: vi.fn() }))

vi.mock('@/lib/db/exchangeDb', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ...db,
}))

vi.mock('@/lib/db/supabase-server', () => ({
  createSupabaseServiceClient: () => serviceClient,
  createSupabaseServerClient: vi.fn(),
}))

import { removeExchangeAccount, toggleExchangeActive } from '@/lib/services/exchangeService'

function builder(error: { message: string } | null) {
  const chain: Record<string, unknown> = {}
  chain.delete = () => chain
  chain.update = () => chain
  chain.eq = () => chain
  chain.then = (resolve: (v: unknown) => unknown) => resolve({ error })
  return chain
}

function makeClients(snapshotError: { message: string } | null) {
  const userTables: string[] = []
  const serviceTables: string[] = []
  const userClient = {
    from: vi.fn((table: string) => {
      userTables.push(table)
      return builder(null)
    }),
  }
  serviceClient.from.mockImplementation((table: string) => {
    serviceTables.push(table)
    return builder(table === 'pnl_snapshots' ? snapshotError : null)
  })
  return { userClient, userTables, serviceTables }
}

describe('tracking data deletion uses the service client for snapshots', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    db.getExchangeAccountById.mockResolvedValue(account)
    db.updateExchangeActive.mockResolvedValue(true)
    db.deleteExchangeAccount.mockResolvedValue(true)
  })

  it('toggle off deletes trades with the user client and snapshots with the service client', async () => {
    const { userClient, userTables, serviceTables } = makeClients(null)
    const result = await toggleExchangeActive(userClient as never, 'user-1', 'acc-1', false)
    expect(result.success).toBe(true)
    expect(userTables).toContain('trades')
    expect(userTables).not.toContain('pnl_snapshots')
    expect(serviceTables).toEqual(['pnl_snapshots'])
  })

  it('toggle off reverts to active when the snapshot delete fails', async () => {
    const { userClient } = makeClients({ message: 'boom' })
    const result = await toggleExchangeActive(userClient as never, 'user-1', 'acc-1', false)
    expect(result).toEqual({ success: false, error: 'INTERNAL_ERROR' })
    expect(db.updateExchangeActive).toHaveBeenLastCalledWith(userClient, 'acc-1', 'user-1', true)
  })

  it('remove deletes snapshots with the service client', async () => {
    const { userClient, userTables, serviceTables } = makeClients(null)
    const result = await removeExchangeAccount(userClient as never, 'user-1', 'acc-1')
    expect(result.success).toBe(true)
    expect(userTables).not.toContain('pnl_snapshots')
    expect(serviceTables).toEqual(['pnl_snapshots'])
  })
})
