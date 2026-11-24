import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/db/supabase-server'
import { CloseDemoOrderBodySchema, DemoTradeIdParamSchema } from '@/lib/validators/demo'
import { closeDemoOrder } from '@/lib/services/demoService'
import { DEMO_ERROR_STATUS } from '@/lib/config/demoTrading'

function failure(code: string): NextResponse {
  return NextResponse.json(
    { success: false, data: null, error: code },
    { status: DEMO_ERROR_STATUS[code] ?? DEMO_ERROR_STATUS.INTERNAL_ERROR }
  )
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return failure('UNAUTHORIZED')

  let body: unknown = {}
  try {
    body = await req.json()
  } catch {
    body = {}
  }

  const parsedBody = CloseDemoOrderBodySchema.safeParse(body)
  const parsedParams = DemoTradeIdParamSchema.safeParse(await params)
  if (!parsedBody.success || !parsedParams.success) return failure('VALIDATION_ERROR')

  const result = await closeDemoOrder(
    supabase,
    user.id,
    parsedParams.data.id,
    parsedBody.data.closeQuantity,
    { orderType: parsedBody.data.orderType, price: parsedBody.data.price }
  )

  if (!result.success) return failure(result.error)

  return NextResponse.json({ success: true, data: result.data, error: null })
}
