import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const claimExchangeScan = vi.hoisted(() => vi.fn())
const getExchangeAccountById = vi.hoisted(() => vi.fn())
const runScan = vi.hoisted(() => vi.fn(async () => undefined))

vi.mock('next/server', async () => {
  const actual = await vi.importActual<typeof import('next/server')>('next/server')
  return {
    ...actual,
    after: (task: () => unknown) => {
      void task()
    },
  }
})

vi.mock('@/lib/db/supabase-server', () => ({
  createSupabaseServerClient: vi.fn(async () => ({
    auth: {
      getUser: async () => ({ data: { user: { id: 'user-1' } } }),
    },
  })),
}))

vi.mock('@/lib/db/exchangeDb', () => ({
  claimExchangeScan,
}))

vi.mock('@/lib/scan/runScan', () => ({
  runScan,
}))

import { POST } from '@/app/api/exchange/sync/route'
import { SCAN_COOLDOWN_MS } from '@/lib/scan/scanLimits'

const accountId = '11111111-1111-4111-8111-111111111111'

function request(): NextRequest {
  return new NextRequest('http://localhost/api/exchange/sync', {
    method: 'POST',
    body: JSON.stringify({ exchangeAccountId: accountId }),
    headers: { 'content-type': 'application/json' },
  })
}

describe('POST /api/exchange/sync', () => {
  beforeEach(() => {
    claimExchangeScan.mockReset()
    runScan.mockClear()
  })

  it('starts one scan when the account is claimed twice', async () => {
    claimExchangeScan.mockResolvedValueOnce('claimed').mockResolvedValueOnce('in_progress')

    const first = await POST(request())
    const second = await POST(request())

    expect(first.status).toBe(202)
    expect(await first.json()).toEqual({
      success: true,
      data: { exchangeAccountId: accountId, sync_status: 'syncing' },
      error: null,
    })
    expect(second.status).toBe(409)
    expect(await second.json()).toMatchObject({ success: false, error: 'SYNC_IN_PROGRESS' })
    expect(runScan).toHaveBeenCalledTimes(1)
  })

  it('refuses a scan for an account the caller does not own', async () => {
    claimExchangeScan.mockResolvedValue('not_found')

    const response = await POST(request())

    expect(response.status).toBe(404)
    expect(await response.json()).toMatchObject({ success: false, error: 'NOT_FOUND' })
    expect(runScan).not.toHaveBeenCalled()
  })
})
