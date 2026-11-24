import { describe, expect, it } from 'vitest'
import { toPnlJob } from '@/lib/pnl/jobMapper'
import { decideJobWatch } from '@/lib/pnl/jobWatch'
import type { PnlJob } from '@/lib/types'

const job = (status: PnlJob['status']): PnlJob => ({
  id: 'j',
  status,
  error: null,
  tradeCount: null,
  createdAt: '2026-01-01T00:00:00Z',
  startedAt: null,
  finishedAt: null,
})

describe('toPnlJob', () => {
  it('maps a full row', () => {
    expect(
      toPnlJob({
        id: 'a',
        status: 'completed',
        error: null,
        trade_count: '5',
        created_at: 'c',
        started_at: 's',
        finished_at: 'f',
      })
    ).toEqual({ id: 'a', status: 'completed', error: null, tradeCount: 5, createdAt: 'c', startedAt: 's', finishedAt: 'f' })
  })

  it('maps missing optional fields to null', () => {
    const mapped = toPnlJob({ id: 'a', status: 'queued', created_at: 'c' })
    expect(mapped.tradeCount).toBeNull()
    expect(mapped.startedAt).toBeNull()
    expect(mapped.finishedAt).toBeNull()
    expect(mapped.error).toBeNull()
  })
})

describe('decideJobWatch', () => {
  it('completes and fails on terminal status', () => {
    expect(decideJobWatch(job('completed'), 0, 100)).toBe('completed')
    expect(decideJobWatch(job('failed'), 0, 100)).toBe('failed')
  })

  it('continues while active and under max wait', () => {
    expect(decideJobWatch(job('running'), 99, 100)).toBe('continue')
    expect(decideJobWatch(null, 50, 100)).toBe('continue')
  })

  it('times out past max wait', () => {
    expect(decideJobWatch(job('running'), 100, 100)).toBe('timeout')
  })
})
