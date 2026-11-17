import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/db/supabase-server'
import { listAiProviders } from '@/lib/services/aiProviderService'
import { aiProviderErrorStatus } from '@/lib/ai/providerHttp'

export async function GET(): Promise<NextResponse> {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ success: false, data: null, error: 'UNAUTHORIZED' }, { status: 401 })
  }

  const result = await listAiProviders(supabase, user.id)
  if (!result.success) {
    return NextResponse.json(
      { success: false, data: null, error: result.error },
      { status: aiProviderErrorStatus(result.error) }
    )
  }

  return NextResponse.json({ success: true, data: result.data, error: null })
}
