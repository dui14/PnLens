import type { PnlJob } from '@/lib/types'
import { PNL_JOB_STALE_AFTER_MS, PNL_SNAPSHOT_COOLDOWN_MS } from './snapshotLimits'

export type CalculationRequestDecision = 'reuse' | 'rate_limited' | 'create'

export function isJobActive(job: Pick<PnlJob, 'status'>): boolean {
  return job.status === 'queued' || job.status === 'running'
}

export function isJobStale(
  job: Pick<PnlJob, 'status' | 'createdAt' | 'startedAt'>,
  now: Date,
  staleAfterMs: number = PNL_JOB_STALE_AFTER_MS
): boolean {
  if (!isJobActive(job)) return false
  const reference = job.status === 'running' && job.startedAt ? job.startedAt : job.createdAt
  return now.getTime() - new Date(reference).getTime() >= staleAfterMs
}

export function staleCutoffIso(now: Date, staleAfterMs: number = PNL_JOB_STALE_AFTER_MS): string {
  return new Date(now.getTime() - staleAfterMs).toISOString()
}

export function decideCalculationRequest(input: {
  activeJob: PnlJob | null
  lastFinishedAt: string | null
  now: Date
  cooldownMs?: number
}): CalculationRequestDecision {
  if (input.activeJob && !isJobStale(input.activeJob, input.now)) return 'reuse'
  const cooldownMs = input.cooldownMs ?? PNL_SNAPSHOT_COOLDOWN_MS
  if (
    input.lastFinishedAt &&
    input.now.getTime() - new Date(input.lastFinishedAt).getTime() < cooldownMs
  ) {
    return 'rate_limited'
  }
  return 'create'
}
