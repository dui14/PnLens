import type { SupabaseClient } from '@supabase/supabase-js'
import type { PnlJob, PnlJobStatus } from '@/lib/types'
import { toPnlJob } from '@/lib/pnl/jobMapper'
import { PNL_JOB_UNIQUE_VIOLATION_CODE } from '@/lib/pnl/snapshotLimits'

const JOB_COLUMNS = 'id, status, error, trade_count, created_at, started_at, finished_at'
const ACTIVE_STATUSES: PnlJobStatus[] = ['queued', 'running']

export type InsertPnlJobResult =
  | { kind: 'created'; job: PnlJob }
  | { kind: 'conflict' }
  | { kind: 'error' }

export async function getActivePnlJob(supabase: SupabaseClient, userId: string): Promise<PnlJob | null> {
  const { data, error } = await supabase
    .from('pnl_calculation_jobs')
    .select(JOB_COLUMNS)
    .eq('user_id', userId)
    .in('status', ACTIVE_STATUSES)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) {
    console.error('[pnlJobsDb] getActivePnlJob failed:', error.message)
    return null
  }
  return data ? toPnlJob(data as Record<string, unknown>) : null
}

export async function getLatestPnlJob(supabase: SupabaseClient, userId: string): Promise<PnlJob | null> {
  const { data, error } = await supabase
    .from('pnl_calculation_jobs')
    .select(JOB_COLUMNS)
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) {
    console.error('[pnlJobsDb] getLatestPnlJob failed:', error.message)
    return null
  }
  return data ? toPnlJob(data as Record<string, unknown>) : null
}

export async function getLastCompletedJobTime(
  supabase: SupabaseClient,
  userId: string
): Promise<string | null> {
  const { data, error } = await supabase
    .from('pnl_calculation_jobs')
    .select('finished_at')
    .eq('user_id', userId)
    .eq('status', 'completed')
    .order('finished_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) {
    console.error('[pnlJobsDb] getLastCompletedJobTime failed:', error.message)
    return null
  }
  return data ? ((data.finished_at as string | null) ?? null) : null
}

export async function failStalePnlJobs(
  supabase: SupabaseClient,
  userId: string,
  staleBeforeIso: string,
  nowIso: string,
  errorCode: string
): Promise<boolean> {
  const { error } = await supabase
    .from('pnl_calculation_jobs')
    .update({ status: 'failed', error: errorCode, finished_at: nowIso })
    .eq('user_id', userId)
    .or(
      `and(status.eq.running,started_at.lte."${staleBeforeIso}"),and(status.eq.queued,created_at.lte."${staleBeforeIso}")`
    )

  if (error) {
    console.error('[pnlJobsDb] failStalePnlJobs failed:', error.message)
  }
  return !error
}

export async function insertPnlJob(supabase: SupabaseClient, userId: string): Promise<InsertPnlJobResult> {
  const { data, error } = await supabase
    .from('pnl_calculation_jobs')
    .insert({ user_id: userId, status: 'queued' })
    .select(JOB_COLUMNS)
    .single()

  if (error) {
    if (error.code === PNL_JOB_UNIQUE_VIOLATION_CODE) return { kind: 'conflict' }
    console.error('[pnlJobsDb] insertPnlJob failed:', error.message)
    return { kind: 'error' }
  }
  return { kind: 'created', job: toPnlJob(data as Record<string, unknown>) }
}

export async function claimPnlJob(
  supabase: SupabaseClient,
  jobId: string,
  userId: string,
  nowIso: string
): Promise<boolean> {
  const { data, error } = await supabase
    .from('pnl_calculation_jobs')
    .update({ status: 'running', started_at: nowIso })
    .eq('id', jobId)
    .eq('user_id', userId)
    .eq('status', 'queued')
    .select('id')

  if (error) {
    console.error('[pnlJobsDb] claimPnlJob failed:', error.message)
    return false
  }
  return (data?.length ?? 0) > 0
}

export async function completePnlJob(
  supabase: SupabaseClient,
  jobId: string,
  userId: string,
  tradeCount: number,
  nowIso: string
): Promise<boolean> {
  const { data, error } = await supabase
    .from('pnl_calculation_jobs')
    .update({ status: 'completed', trade_count: tradeCount, finished_at: nowIso, error: null })
    .eq('id', jobId)
    .eq('user_id', userId)
    .eq('status', 'running')
    .select('id')

  if (error) {
    console.error('[pnlJobsDb] completePnlJob failed:', error.message)
    return false
  }
  return (data?.length ?? 0) > 0
}

export async function failPnlJob(
  supabase: SupabaseClient,
  jobId: string,
  userId: string,
  errorCode: string,
  nowIso: string
): Promise<boolean> {
  const { error } = await supabase
    .from('pnl_calculation_jobs')
    .update({ status: 'failed', error: errorCode, finished_at: nowIso })
    .eq('id', jobId)
    .eq('user_id', userId)
    .in('status', ACTIVE_STATUSES)

  if (error) {
    console.error('[pnlJobsDb] failPnlJob failed:', error.message)
  }
  return !error
}
