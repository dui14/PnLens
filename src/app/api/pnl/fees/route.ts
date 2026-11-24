import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/db/supabase-server'
import { fetchFeeSummary } from '@/lib/services/pnlService'
import { FeeSummaryQuerySchema } from '@/lib/validators/pnl'
import { pnlTimeFields } from '@/lib/time/dayBoundary'

const PNL_ERROR_STATUS = {
  NOT_FOUND: 404,
  UNAUTHORIZED: 401,
} as const

function statusFor(error: string): number {
  if (error === 'NOT_FOUND') return PNL_ERROR_STATUS.NOT_FOUND
  if (error === 'UNAUTHORIZED') return PNL_ERROR_STATUS.UNAUTHORIZED
  return 500
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json(
      { success: false, data: null, error: 'UNAUTHORIZED' },
      { status: 401 }
    )
  }

  const { searchParams } = req.nextUrl
  const parsed = FeeSummaryQuerySchema.safeParse({
    exchange: searchParams.get('exchange') ?? undefined,
    segment: searchParams.get('segment') ?? undefined,
  })

  if (!parsed.success) {
    return NextResponse.json(
      { success: false, data: null, error: 'VALIDATION_ERROR' },
      { status: 400 }
    )
  }

  const result = await fetchFeeSummary(
    supabase,
    user.id,
    parsed.data.segment,
    parsed.data.exchange
  )

  if (!result.success) {
    return NextResponse.json(
      { success: false, data: null, error: result.error, ...pnlTimeFields() },
      { status: statusFor(result.error) }
    )
  }

  return NextResponse.json({ success: true, data: result.data, error: null, ...pnlTimeFields() })
}
