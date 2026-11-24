import { after, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/db/supabase-server'
import { createServiceRoleClient } from '@/lib/db/serviceRoleClient'
import { retryAfterHeaders } from '@/lib/cooldown/cooldown'
import { enqueuePnlJob, fetchCalculateRetryAt, runPnlCalculationJob } from '@/lib/services/pnlJobService'
import { pnlTimeFields } from '@/lib/time/dayBoundary'

const CALCULATE_ERROR_STATUS: Record<string, number> = {
  UNAUTHORIZED: 401,
  RATE_LIMITED: 429,
}

function failure(error: string): NextResponse {
  return NextResponse.json(
    { success: false, data: null, error, ...pnlTimeFields() },
    { status: CALCULATE_ERROR_STATUS[error] ?? 500 }
  )
}

export async function POST(): Promise<NextResponse> {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return failure('UNAUTHORIZED')

  const serviceClient = createServiceRoleClient()
  if (!serviceClient) return failure('SERVER_MISCONFIGURED')

  const enqueued = await enqueuePnlJob(serviceClient, user.id)
  if (!enqueued.success) {
    if (enqueued.error !== 'RATE_LIMITED') return failure(enqueued.error)
    const now = new Date()
    const retryAt = await fetchCalculateRetryAt(serviceClient, user.id, now)
    return NextResponse.json(
      { success: false, data: null, error: enqueued.error, retryAt, ...pnlTimeFields() },
      { status: CALCULATE_ERROR_STATUS.RATE_LIMITED, headers: retryAfterHeaders(retryAt, now) }
    )
  }

  const { job, created } = enqueued.data

  if (created) {
    const userId = user.id
    after(() => {
      void runPnlCalculationJob(serviceClient, job.id, userId).catch(() => {
        console.error('[pnl/calculate] background calculation failed:', 'CALCULATION_FAILED')
      })
    })
  }

  return NextResponse.json(
    { success: true, data: { job, created }, error: null, ...pnlTimeFields() },
    { status: created ? 202 : 200 }
  )
}
