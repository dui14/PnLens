import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/db/supabase-server'
import { fetchCalculateAvailableAt, fetchLatestPnlJob } from '@/lib/services/pnlJobService'
import { pnlTimeFields } from '@/lib/time/dayBoundary'

export async function GET(): Promise<NextResponse> {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json(
      { success: false, data: null, error: 'UNAUTHORIZED', ...pnlTimeFields() },
      { status: 401 }
    )
  }

  const [result, calculateAvailableAt] = await Promise.all([
    fetchLatestPnlJob(supabase, user.id),
    fetchCalculateAvailableAt(supabase, user.id),
  ])
  if (!result.success) {
    return NextResponse.json(
      { success: false, data: null, error: result.error, ...pnlTimeFields() },
      { status: 500 }
    )
  }

  return NextResponse.json({
    success: true,
    data: { job: result.data, calculateAvailableAt },
    error: null,
    ...pnlTimeFields(),
  })
}
