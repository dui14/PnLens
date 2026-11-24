import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/db/supabase-server'
import { PnlSnapshotQuerySchema } from '@/lib/validators/pnl'
import { fetchPnlSnapshot } from '@/lib/services/pnlService'
import { fetchCalculateAvailableAt, fetchLatestPnlJob } from '@/lib/services/pnlJobService'
import { pnlTimeFields } from '@/lib/time/dayBoundary'

const SNAPSHOT_ERROR_STATUS: Record<string, number> = {
  UNAUTHORIZED: 401,
  VALIDATION_ERROR: 400,
}

function statusFor(error: string): number {
  return SNAPSHOT_ERROR_STATUS[error] ?? 500
}

function failure(error: string): NextResponse {
  return NextResponse.json(
    { success: false, data: null, error, ...pnlTimeFields() },
    { status: statusFor(error) }
  )
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return failure('UNAUTHORIZED')

  const { searchParams } = req.nextUrl
  const parsed = PnlSnapshotQuerySchema.safeParse({
    exchange: searchParams.get('exchange') ?? undefined,
    segment: searchParams.get('segment') ?? undefined,
  })

  if (!parsed.success) return failure('VALIDATION_ERROR')

  const [snapshot, job, calculateAvailableAt] = await Promise.all([
    fetchPnlSnapshot(supabase, user.id, parsed.data.segment, parsed.data.exchange),
    fetchLatestPnlJob(supabase, user.id),
    fetchCalculateAvailableAt(supabase, user.id),
  ])
  if (!snapshot.success) return failure(snapshot.error)
  if (!job.success) return failure(job.error)

  return NextResponse.json({
    success: true,
    data: { snapshot: snapshot.data, job: job.data, calculateAvailableAt },
    error: null,
    ...pnlTimeFields(),
  })
}
