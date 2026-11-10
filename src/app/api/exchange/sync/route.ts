import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/db/supabase-server'
import { SyncExchangeSchema } from '@/lib/validators/exchange'
import { syncExchangeAccount } from '@/lib/services/exchangeService'

export async function POST(req: NextRequest): Promise<NextResponse> {
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

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json(
      { success: false, data: null, error: 'VALIDATION_ERROR' },
      { status: 400 }
    )
  }

  const parsed = SyncExchangeSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, data: null, error: 'VALIDATION_ERROR' },
      { status: 400 }
    )
  }

  const result = await syncExchangeAccount(supabase, user.id, parsed.data.exchangeAccountId)

  if (!result.success) {
    const statusMap: Record<string, number> = {
      NOT_FOUND: 404,
      ACCOUNT_INACTIVE: 400,
      API_KEY_NOT_FOUND: 404,
      NO_KEY: 404,
      DECRYPTION_FAILED: 500,
      EXCHANGE_REGION_BLOCKED: 502,
      EXCHANGE_UNREACHABLE: 502,
      EXCHANGE_TIME_DRIFT: 400,
      EXCHANGE_ERROR: 502,
      INTERNAL_ERROR: 500,
    }
    return NextResponse.json(
      { success: false, data: null, error: result.error },
      { status: statusMap[result.error] ?? 500 }
    )
  }

  return NextResponse.json({ success: true, data: result.data, error: null })
}
