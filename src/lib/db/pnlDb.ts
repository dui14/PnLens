import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  PnlSnapshotPayload,
  PnlSnapshotRecord,
  PnlSnapshotRowInput,
  SnapshotExchange,
  TradeSegment,
} from '@/lib/types'

const SNAPSHOT_CONFLICT_KEY = 'user_id,segment,exchange'

export type PnlSnapshotUpsertRow = PnlSnapshotRowInput & {
  user_id: string
  job_id: string
  calculated_at: string
}

export async function getPnlSnapshot(
  supabase: SupabaseClient,
  userId: string,
  segment: TradeSegment,
  exchange: SnapshotExchange
): Promise<PnlSnapshotRecord | null> {
  const { data, error } = await supabase
    .from('pnl_snapshots')
    .select('payload, calculated_at')
    .eq('user_id', userId)
    .eq('segment', segment)
    .eq('exchange', exchange)
    .maybeSingle()

  if (error) {
    console.error('[pnlDb] getPnlSnapshot failed:', error.message)
    return null
  }
  if (!data) return null

  return {
    calculatedAt: data.calculated_at as string,
    payload: data.payload as PnlSnapshotPayload,
  }
}

export async function upsertPnlSnapshots(
  supabase: SupabaseClient,
  rows: PnlSnapshotUpsertRow[]
): Promise<boolean> {
  const { error } = await supabase.from('pnl_snapshots').upsert(rows, { onConflict: SNAPSHOT_CONFLICT_KEY })

  if (error) {
    console.error('[pnlDb] upsertPnlSnapshots failed:', error.message)
  }
  return !error
}
