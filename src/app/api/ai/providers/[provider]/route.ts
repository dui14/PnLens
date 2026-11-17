import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/db/supabase-server'
import { removeAiProvider, saveAiProviderKey } from '@/lib/services/aiProviderService'
import { AiProviderParamSchema, SaveAiProviderKeySchema } from '@/lib/validators/aiProvider'
import { aiProviderErrorStatus } from '@/lib/ai/providerHttp'
import type { AiProvider } from '@/lib/types'

type RouteContext = { params: Promise<{ provider: string }> }

function fail(error: string): NextResponse {
  return NextResponse.json(
    { success: false, data: null, error },
    { status: aiProviderErrorStatus(error) }
  )
}

export async function PUT(req: NextRequest, { params }: RouteContext): Promise<NextResponse> {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return fail('UNAUTHORIZED')

  const provider = AiProviderParamSchema.safeParse((await params).provider)
  if (!provider.success) return fail('VALIDATION_ERROR')

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return fail('VALIDATION_ERROR')
  }

  const parsed = SaveAiProviderKeySchema.safeParse(body)
  if (!parsed.success) return fail('VALIDATION_ERROR')

  const result = await saveAiProviderKey(supabase, user.id, provider.data as AiProvider, parsed.data.apiKey)
  if (!result.success) return fail(result.error)

  return NextResponse.json({ success: true, data: null, error: null })
}

export async function DELETE(_req: NextRequest, { params }: RouteContext): Promise<NextResponse> {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return fail('UNAUTHORIZED')

  const provider = AiProviderParamSchema.safeParse((await params).provider)
  if (!provider.success) return fail('VALIDATION_ERROR')

  const result = await removeAiProvider(supabase, user.id, provider.data as AiProvider)
  if (!result.success) return fail(result.error)

  return NextResponse.json({ success: true, data: null, error: null })
}
