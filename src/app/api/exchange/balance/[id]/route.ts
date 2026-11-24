import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/db/supabase-server'
import { fetchExchangeBalance } from '@/lib/services/exchangeService'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ success: false, data: null, error: 'UNAUTHORIZED' }, { status: 401 })
  }

  const { id } = await params
  const result = await fetchExchangeBalance(supabase, user.id, id)

  if (!result.success) {
    const statusMap: Record<string, number> = {
      NOT_FOUND: 404,
      ACCOUNT_INACTIVE: 400,
      API_KEY_NOT_FOUND: 404,
      NO_KEY: 404,
      DECRYPTION_FAILED: 500,
    }

    return NextResponse.json(
      { success: false, data: null, error: result.error },
      { status: statusMap[result.error] ?? 500 }
    )
  }

  return NextResponse.json({ success: true, data: result.data, error: null })
}
