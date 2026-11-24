import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/db/supabase-server'
import { DemoTradeIdParamSchema } from '@/lib/validators/demo'
import { cancelDemoOrder } from '@/lib/services/demoService'
import { DEMO_ERROR_STATUS } from '@/lib/config/demoTrading'

function failure(code: string): NextResponse {
  return NextResponse.json(
    { success: false, data: null, error: code },
    { status: DEMO_ERROR_STATUS[code] ?? DEMO_ERROR_STATUS.INTERNAL_ERROR }
  )
}

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return failure('UNAUTHORIZED')

  const parsedParams = DemoTradeIdParamSchema.safeParse(await params)
  if (!parsedParams.success) return failure('VALIDATION_ERROR')

  const result = await cancelDemoOrder(supabase, user.id, parsedParams.data.id)
  if (!result.success) return failure(result.error)

  return NextResponse.json({ success: true, data: result.data, error: null })
}
