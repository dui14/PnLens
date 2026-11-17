import type { PnlJob, PnlJobStatus } from '@/lib/types'

export function toPnlJob(row: Record<string, unknown>): PnlJob {
  return {
    id: String(row.id),
    status: row.status as PnlJobStatus,
    error: (row.error as string | null) ?? null,
    tradeCount: row.trade_count == null ? null : Number(row.trade_count),
    createdAt: String(row.created_at),
    startedAt: (row.started_at as string | null) ?? null,
    finishedAt: (row.finished_at as string | null) ?? null,
  }
}
