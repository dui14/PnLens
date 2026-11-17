import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/db/supabase-server'
import { PlaceDemoOrderSchema, CloseDemoOrderSchema } from '@/lib/validators/demo'
import { placeDemoOrder, closeDemoOrder } from '@/lib/services/demoService'
import { DEMO_ERROR_STATUS } from '@/lib/config/demoTrading'

function failure(code: string): NextResponse {
  return NextResponse.json(
    { success: false, data: null, error: code },
    { status: DEMO_ERROR_STATUS[code] ?? DEMO_ERROR_STATUS.INTERNAL_ERROR }
  )
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return failure('UNAUTHORIZED')

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return failure('VALIDATION_ERROR')
  }

  const parsed = PlaceDemoOrderSchema.safeParse(body)
  if (!parsed.success) return failure('VALIDATION_ERROR')

  const result = await placeDemoOrder(supabase, user.id, {
    ...parsed.data,
    price: parsed.data.price ?? null,
    takeProfit: parsed.data.takeProfit ?? null,
    stopLoss: parsed.data.stopLoss ?? null,
  })

  if (!result.success) return failure(result.error)

  return NextResponse.json({ success: true, data: result.data, error: null }, { status: 201 })
}

export async function PATCH(req: NextRequest): Promise<NextResponse> {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return failure('UNAUTHORIZED')

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return failure('VALIDATION_ERROR')
  }

  const parsed = CloseDemoOrderSchema.safeParse(body)
  if (!parsed.success) return failure('VALIDATION_ERROR')

  const result = await closeDemoOrder(supabase, user.id, parsed.data.tradeId, parsed.data.closeQuantity, {
    orderType: parsed.data.orderType,
    price: parsed.data.price,
  })

  if (!result.success) return failure(result.error)

  return NextResponse.json({ success: true, data: result.data, error: null })
}
