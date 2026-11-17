import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient, createSupabaseServiceClient } from '@/lib/db/supabase-server'
import { UpdateSettingsSchema } from '@/lib/validators/settings'
import { updateSettings, getSettings } from '@/lib/services/settingsService'
import { upsertUser } from '@/lib/db/usersDb'

export async function GET(_req: NextRequest): Promise<NextResponse> {
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

  let result = await getSettings(supabase, user.id)

  if (!result.success && result.error === 'NOT_FOUND') {
    const serviceClient = createSupabaseServiceClient()
    await upsertUser(serviceClient, user.id, user.email ?? '')
    result = await getSettings(supabase, user.id)
  }

  if (!result.success) {
    return NextResponse.json(
      { success: false, data: null, error: result.error },
      { status: 404 }
    )
  }

  return NextResponse.json({ success: true, data: result.data, error: null })
}

export async function PATCH(req: NextRequest): Promise<NextResponse> {
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

  const parsed = UpdateSettingsSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, data: null, error: 'VALIDATION_ERROR' },
      { status: 400 }
    )
  }

  const result = await updateSettings(supabase, user.id, {
    displayName: parsed.data.displayName,
  })

  if (!result.success) {
    const statusMap: Record<string, number> = {
      NO_CHANGES: 400,
      INTERNAL_ERROR: 500,
    }
    return NextResponse.json(
      { success: false, data: null, error: result.error },
      { status: statusMap[result.error] ?? 500 }
    )
  }

  return NextResponse.json({ success: true, data: result.data, error: null })
}
