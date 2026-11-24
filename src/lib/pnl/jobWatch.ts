import type { PnlJob } from '@/lib/types'

export type JobWatchOutcome = 'continue' | 'completed' | 'failed' | 'timeout'

export function decideJobWatch(job: PnlJob | null, elapsedMs: number, maxWaitMs: number): JobWatchOutcome {
  if (job?.status === 'completed') return 'completed'
  if (job?.status === 'failed') return 'failed'
  if (elapsedMs >= maxWaitMs) return 'timeout'
  return 'continue'
}
