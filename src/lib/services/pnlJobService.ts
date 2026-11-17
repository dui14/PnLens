import type { SupabaseClient } from '@supabase/supabase-js'
import { buildPnlSnapshotRows } from '@/lib/engines/pnlSnapshotEngine'
import {
  claimPnlJob,
  completePnlJob,
  failPnlJob,
  failStalePnlJobs,
  getActivePnlJob,
  getLastCompletedJobTime,
  getLatestPnlJob,
  insertPnlJob,
} from '@/lib/db/pnlJobsDb'
import { upsertPnlSnapshots } from '@/lib/db/pnlDb'
import { fetchTradesForPNL } from '@/lib/db/tradesDb'
import { cooldownAvailableAt, cooldownRetryAt } from '@/lib/cooldown/cooldown'
import { decideCalculationRequest, isJobStale, staleCutoffIso } from '@/lib/pnl/jobState'
import { PNL_JOB_STALE_ERROR, PNL_SNAPSHOT_COOLDOWN_MS } from '@/lib/pnl/snapshotLimits'
import type { PnlJob, Result } from '@/lib/types'

export const PNL_JOB_ERRORS = {
  CLAIM_LOST: 'JOB_CLAIM_LOST',
  STORE_FAILED: 'SNAPSHOT_STORE_FAILED',
  CALCULATION_FAILED: 'CALCULATION_FAILED',
  ENQUEUE_FAILED: 'JOB_ENQUEUE_FAILED',
} as const

export type EnqueuedPnlJob = {
  job: PnlJob
  created: boolean
}

export async function enqueuePnlJob(
  supabase: SupabaseClient,
  userId: string,
  now: Date = new Date()
): Promise<Result<EnqueuedPnlJob>> {
  await failStalePnlJobs(supabase, userId, staleCutoffIso(now), now.toISOString(), PNL_JOB_STALE_ERROR)

  const activeJob = await getActivePnlJob(supabase, userId)
  const lastFinishedAt = await getLastCompletedJobTime(supabase, userId)
  const decision = decideCalculationRequest({ activeJob, lastFinishedAt, now })

  if (decision === 'reuse' && activeJob) return { success: true, data: { job: activeJob, created: false } }
  if (decision === 'rate_limited') return { success: false, error: 'RATE_LIMITED' }

  const inserted = await insertPnlJob(supabase, userId)
  if (inserted.kind === 'created') return { success: true, data: { job: inserted.job, created: true } }

  if (inserted.kind === 'conflict') {
    const existing = await getActivePnlJob(supabase, userId)
    if (existing) return { success: true, data: { job: existing, created: false } }
  }
  return { success: false, error: PNL_JOB_ERRORS.ENQUEUE_FAILED }
}

export async function runPnlCalculationJob(
  supabase: SupabaseClient,
  jobId: string,
  userId: string,
  now: () => Date = () => new Date()
): Promise<Result<{ tradeCount: number }>> {
  const claimed = await claimPnlJob(supabase, jobId, userId, now().toISOString())
  if (!claimed) return { success: false, error: PNL_JOB_ERRORS.CLAIM_LOST }

  const fail = async (code: string): Promise<Result<{ tradeCount: number }>> => {
    await failPnlJob(supabase, jobId, userId, code, now().toISOString())
    return { success: false, error: code }
  }

  try {
    const tradesResult = await fetchTradesForPNL(supabase, userId, {})
    if (!tradesResult.success) return await fail(tradesResult.error)

    const calculatedAt = now()
    const calculatedAtIso = calculatedAt.toISOString()
    const rows = buildPnlSnapshotRows(tradesResult.data, calculatedAt).map((row) => ({
      ...row,
      user_id: userId,
      job_id: jobId,
      calculated_at: calculatedAtIso,
    }))

    const stored = await upsertPnlSnapshots(supabase, rows)
    if (!stored) return await fail(PNL_JOB_ERRORS.STORE_FAILED)

    const tradeCount = tradesResult.data.length
    const completed = await completePnlJob(supabase, jobId, userId, tradeCount, now().toISOString())
    if (!completed) return { success: false, error: PNL_JOB_ERRORS.CLAIM_LOST }

    return { success: true, data: { tradeCount } }
  } catch {
    return await fail(PNL_JOB_ERRORS.CALCULATION_FAILED)
  }
}

export function presentPnlJob(job: PnlJob | null, now: Date): PnlJob | null {
  if (!job || !isJobStale(job, now)) return job
  return { ...job, status: 'failed', error: PNL_JOB_STALE_ERROR }
}

export async function fetchLatestPnlJob(
  supabase: SupabaseClient,
  userId: string,
  now: Date = new Date()
): Promise<Result<PnlJob | null>> {
  const job = await getLatestPnlJob(supabase, userId)
  return { success: true, data: presentPnlJob(job, now) }
}

export async function fetchCalculateAvailableAt(
  supabase: SupabaseClient,
  userId: string,
  now: Date = new Date()
): Promise<string | null> {
  const lastFinishedAt = await getLastCompletedJobTime(supabase, userId)
  return cooldownAvailableAt(lastFinishedAt, PNL_SNAPSHOT_COOLDOWN_MS, now)
}

export async function fetchCalculateRetryAt(
  supabase: SupabaseClient,
  userId: string,
  now: Date = new Date()
): Promise<string> {
  const lastFinishedAt = await getLastCompletedJobTime(supabase, userId)
  return cooldownRetryAt(lastFinishedAt, PNL_SNAPSHOT_COOLDOWN_MS, now)
}
