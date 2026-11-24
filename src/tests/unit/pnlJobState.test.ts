import { describe, expect, it } from 'vitest'
import { decideCalculationRequest, isJobActive, isJobStale, staleCutoffIso } from '@/lib/pnl/jobState'
import { PNL_JOB_STALE_AFTER_MS, PNL_SNAPSHOT_COOLDOWN_MS } from '@/lib/pnl/snapshotLimits'
import type { PnlJob } from '@/lib/types'

const NOW = new Date('2026-11-15T10:00:00.000Z')

function job(overrides: Partial<PnlJob> = {}): PnlJob {
  return {
    id: 'job-1',
    status: 'queued',
    error: null,
    tradeCount: null,
    createdAt: NOW.toISOString(),
    startedAt: null,
    finishedAt: null,
    ...overrides,
  }
}

function ago(ms: number): string {
  return new Date(NOW.getTime() - ms).toISOString()
}

describe('isJobActive', () => {
  it('is true only for queued and running', () => {
    expect(isJobActive(job({ status: 'queued' }))).toBe(true)
    expect(isJobActive(job({ status: 'running' }))).toBe(true)
    expect(isJobActive(job({ status: 'completed' }))).toBe(false)
    expect(isJobActive(job({ status: 'failed' }))).toBe(false)
  })
})

describe('isJobStale', () => {
  it('uses started_at for running jobs', () => {
    const running = job({ status: 'running', createdAt: ago(PNL_JOB_STALE_AFTER_MS * 5), startedAt: ago(1000) })
    expect(isJobStale(running, NOW)).toBe(false)
    const old = job({ status: 'running', startedAt: ago(PNL_JOB_STALE_AFTER_MS) })
    expect(isJobStale(old, NOW)).toBe(true)
  })

  it('uses created_at for queued jobs', () => {
    expect(isJobStale(job({ createdAt: ago(PNL_JOB_STALE_AFTER_MS - 1) }), NOW)).toBe(false)
    expect(isJobStale(job({ createdAt: ago(PNL_JOB_STALE_AFTER_MS) }), NOW)).toBe(true)
  })

  it('never marks finished jobs stale', () => {
    expect(isJobStale(job({ status: 'completed', createdAt: ago(PNL_JOB_STALE_AFTER_MS * 10) }), NOW)).toBe(false)
  })
})

describe('staleCutoffIso', () => {
  it('subtracts the stale window', () => {
    expect(staleCutoffIso(NOW)).toBe(ago(PNL_JOB_STALE_AFTER_MS))
  })
})

describe('decideCalculationRequest', () => {
  it('reuses a fresh active job', () => {
    expect(decideCalculationRequest({ activeJob: job(), lastFinishedAt: null, now: NOW })).toBe('reuse')
  })

  it('ignores a stale active job and creates', () => {
    const stale = job({ status: 'running', startedAt: ago(PNL_JOB_STALE_AFTER_MS + 1) })
    expect(decideCalculationRequest({ activeJob: stale, lastFinishedAt: null, now: NOW })).toBe('create')
  })

  it('rate limits inside the cooldown window', () => {
    expect(
      decideCalculationRequest({ activeJob: null, lastFinishedAt: ago(PNL_SNAPSHOT_COOLDOWN_MS - 1), now: NOW })
    ).toBe('rate_limited')
  })

  it('creates after the cooldown window', () => {
    expect(
      decideCalculationRequest({ activeJob: null, lastFinishedAt: ago(PNL_SNAPSHOT_COOLDOWN_MS), now: NOW })
    ).toBe('create')
  })

  it('creates with no history', () => {
    expect(decideCalculationRequest({ activeJob: null, lastFinishedAt: null, now: NOW })).toBe('create')
  })
})
