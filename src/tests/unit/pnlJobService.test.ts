import type { SupabaseClient } from '@supabase/supabase-js'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SNAPSHOT_EXCHANGES, TRADE_SEGMENTS, type PnlJob } from '@/lib/types'
import { PNL_JOB_STALE_AFTER_MS, PNL_JOB_STALE_ERROR, PNL_SNAPSHOT_COOLDOWN_MS } from '@/lib/pnl/snapshotLimits'

const jobsDb = vi.hoisted(() => ({
  claimPnlJob: vi.fn(),
  completePnlJob: vi.fn(),
  failPnlJob: vi.fn(),
  failStalePnlJobs: vi.fn(),
  getActivePnlJob: vi.fn(),
  getLastCompletedJobTime: vi.fn(),
  getLatestPnlJob: vi.fn(),
  insertPnlJob: vi.fn(),
}))
const pnlDb = vi.hoisted(() => ({ upsertPnlSnapshots: vi.fn() }))
const tradesDb = vi.hoisted(() => ({ fetchTradesForPNL: vi.fn() }))

vi.mock('@/lib/db/pnlJobsDb', () => jobsDb)
vi.mock('@/lib/db/pnlDb', () => pnlDb)
vi.mock('@/lib/db/tradesDb', () => tradesDb)

import {
  enqueuePnlJob,
  fetchCalculateAvailableAt,
  fetchCalculateRetryAt,
  PNL_JOB_ERRORS,
  presentPnlJob,
  runPnlCalculationJob,
} from '@/lib/services/pnlJobService'

const client = {} as SupabaseClient
const NOW = new Date('2026-11-15T10:00:00.000Z')
const EXPECTED_ROWS = TRADE_SEGMENTS.length * SNAPSHOT_EXCHANGES.length

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

beforeEach(() => {
  vi.resetAllMocks()
  jobsDb.failStalePnlJobs.mockResolvedValue(true)
  jobsDb.failPnlJob.mockResolvedValue(true)
  jobsDb.completePnlJob.mockResolvedValue(true)
  jobsDb.claimPnlJob.mockResolvedValue(true)
  jobsDb.getActivePnlJob.mockResolvedValue(null)
  jobsDb.getLastCompletedJobTime.mockResolvedValue(null)
})

describe('runPnlCalculationJob', () => {
  it('stops without touching data when the claim is lost', async () => {
    jobsDb.claimPnlJob.mockResolvedValue(false)
    const result = await runPnlCalculationJob(client, 'job-1', 'user-1', () => NOW)
    expect(result).toEqual({ success: false, error: PNL_JOB_ERRORS.CLAIM_LOST })
    expect(tradesDb.fetchTradesForPNL).not.toHaveBeenCalled()
    expect(pnlDb.upsertPnlSnapshots).not.toHaveBeenCalled()
  })

  it('fails the job and stores nothing when the trades fetch errors', async () => {
    tradesDb.fetchTradesForPNL.mockResolvedValue({ success: false, error: 'TRADES_FETCH_FAILED' })
    const result = await runPnlCalculationJob(client, 'job-1', 'user-1', () => NOW)
    expect(result).toEqual({ success: false, error: 'TRADES_FETCH_FAILED' })
    expect(pnlDb.upsertPnlSnapshots).not.toHaveBeenCalled()
    expect(jobsDb.completePnlJob).not.toHaveBeenCalled()
    expect(jobsDb.failPnlJob).toHaveBeenCalledWith(client, 'job-1', 'user-1', 'TRADES_FETCH_FAILED', NOW.toISOString())
  })

  it('filters trades by the job user explicitly', async () => {
    tradesDb.fetchTradesForPNL.mockResolvedValue({ success: true, data: [] })
    pnlDb.upsertPnlSnapshots.mockResolvedValue(true)
    await runPnlCalculationJob(client, 'job-1', 'user-1', () => NOW)
    expect(tradesDb.fetchTradesForPNL).toHaveBeenCalledWith(client, 'user-1', {})
  })

  it('upserts every segment and exchange row tagged with the job and completes', async () => {
    tradesDb.fetchTradesForPNL.mockResolvedValue({ success: true, data: [] })
    pnlDb.upsertPnlSnapshots.mockResolvedValue(true)
    const result = await runPnlCalculationJob(client, 'job-1', 'user-1', () => NOW)
    expect(result).toEqual({ success: true, data: { tradeCount: 0 } })
    const rows = pnlDb.upsertPnlSnapshots.mock.calls[0][1] as { user_id: string; job_id: string }[]
    expect(rows).toHaveLength(EXPECTED_ROWS)
    expect(rows.every((row) => row.user_id === 'user-1' && row.job_id === 'job-1')).toBe(true)
    expect(jobsDb.completePnlJob).toHaveBeenCalledWith(client, 'job-1', 'user-1', 0, NOW.toISOString())
    expect(jobsDb.failPnlJob).not.toHaveBeenCalled()
  })

  it('fails the job when the snapshot store fails', async () => {
    tradesDb.fetchTradesForPNL.mockResolvedValue({ success: true, data: [] })
    pnlDb.upsertPnlSnapshots.mockResolvedValue(false)
    const result = await runPnlCalculationJob(client, 'job-1', 'user-1', () => NOW)
    expect(result).toEqual({ success: false, error: PNL_JOB_ERRORS.STORE_FAILED })
    expect(jobsDb.completePnlJob).not.toHaveBeenCalled()
    expect(jobsDb.failPnlJob).toHaveBeenCalledWith(
      client,
      'job-1',
      'user-1',
      PNL_JOB_ERRORS.STORE_FAILED,
      NOW.toISOString()
    )
  })

  it('fails the job when an unexpected error is thrown', async () => {
    tradesDb.fetchTradesForPNL.mockRejectedValue(new Error('boom'))
    const result = await runPnlCalculationJob(client, 'job-1', 'user-1', () => NOW)
    expect(result).toEqual({ success: false, error: PNL_JOB_ERRORS.CALCULATION_FAILED })
    expect(jobsDb.failPnlJob).toHaveBeenCalled()
  })
})

describe('enqueuePnlJob', () => {
  it('recovers stale jobs before deciding', async () => {
    jobsDb.insertPnlJob.mockResolvedValue({ kind: 'created', job: job() })
    await enqueuePnlJob(client, 'user-1', NOW)
    expect(jobsDb.failStalePnlJobs).toHaveBeenCalledWith(
      client,
      'user-1',
      new Date(NOW.getTime() - PNL_JOB_STALE_AFTER_MS).toISOString(),
      NOW.toISOString(),
      PNL_JOB_STALE_ERROR
    )
  })

  it('returns the active job without inserting', async () => {
    const active = job({ status: 'running', startedAt: NOW.toISOString() })
    jobsDb.getActivePnlJob.mockResolvedValue(active)
    const result = await enqueuePnlJob(client, 'user-1', NOW)
    expect(result).toEqual({ success: true, data: { job: active, created: false } })
    expect(jobsDb.insertPnlJob).not.toHaveBeenCalled()
  })

  it('rate limits after a recent completed job', async () => {
    jobsDb.getLastCompletedJobTime.mockResolvedValue(NOW.toISOString())
    const result = await enqueuePnlJob(client, 'user-1', NOW)
    expect(result).toEqual({ success: false, error: 'RATE_LIMITED' })
    expect(jobsDb.insertPnlJob).not.toHaveBeenCalled()
  })

  it('creates a queued job', async () => {
    const created = job()
    jobsDb.insertPnlJob.mockResolvedValue({ kind: 'created', job: created })
    const result = await enqueuePnlJob(client, 'user-1', NOW)
    expect(result).toEqual({ success: true, data: { job: created, created: true } })
  })

  it('returns the existing job when the unique index rejects a racing insert', async () => {
    const existing = job({ id: 'job-0' })
    jobsDb.insertPnlJob.mockResolvedValue({ kind: 'conflict' })
    jobsDb.getActivePnlJob.mockResolvedValueOnce(null).mockResolvedValueOnce(existing)
    const result = await enqueuePnlJob(client, 'user-1', NOW)
    expect(result).toEqual({ success: true, data: { job: existing, created: false } })
  })

  it('reports an enqueue failure', async () => {
    jobsDb.insertPnlJob.mockResolvedValue({ kind: 'error' })
    const result = await enqueuePnlJob(client, 'user-1', NOW)
    expect(result).toEqual({ success: false, error: PNL_JOB_ERRORS.ENQUEUE_FAILED })
  })
})

describe('presentPnlJob', () => {
  it('shows a stale active job as failed', () => {
    const stale = job({ status: 'running', startedAt: new Date(NOW.getTime() - PNL_JOB_STALE_AFTER_MS).toISOString() })
    expect(presentPnlJob(stale, NOW)).toMatchObject({ status: 'failed', error: PNL_JOB_STALE_ERROR })
  })

  it('passes fresh jobs and null through', () => {
    const fresh = job()
    expect(presentPnlJob(fresh, NOW)).toBe(fresh)
    expect(presentPnlJob(null, NOW)).toBeNull()
  })
})

describe('calculate availability', () => {
  it('computes availableAt from the last completed job', async () => {
    const finished = new Date(NOW.getTime() - 30_000)
    jobsDb.getLastCompletedJobTime.mockResolvedValue(finished.toISOString())
    expect(await fetchCalculateAvailableAt(client, 'user-1', NOW)).toBe(
      new Date(finished.getTime() + PNL_SNAPSHOT_COOLDOWN_MS).toISOString()
    )
    expect(await fetchCalculateRetryAt(client, 'user-1', NOW)).toBe(
      new Date(finished.getTime() + PNL_SNAPSHOT_COOLDOWN_MS).toISOString()
    )
  })

  it('is null once the cooldown elapsed and retryAt falls back to now plus cooldown', async () => {
    jobsDb.getLastCompletedJobTime.mockResolvedValue(
      new Date(NOW.getTime() - PNL_SNAPSHOT_COOLDOWN_MS).toISOString()
    )
    expect(await fetchCalculateAvailableAt(client, 'user-1', NOW)).toBeNull()
    expect(await fetchCalculateRetryAt(client, 'user-1', NOW)).toBe(
      new Date(NOW.getTime() + PNL_SNAPSHOT_COOLDOWN_MS).toISOString()
    )
  })

  it('is null when nothing completed yet', async () => {
    jobsDb.getLastCompletedJobTime.mockResolvedValue(null)
    expect(await fetchCalculateAvailableAt(client, 'user-1', NOW)).toBeNull()
  })
})
