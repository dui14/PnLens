import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/db/supabase-server'
import { removeAvatar, uploadAvatar } from '@/lib/services/avatarService'
import { AVATAR_FORM_FIELD } from '@/lib/avatar/avatarConfig'

const ERROR_STATUS: Record<string, number> = {
  INVALID_FILE_TYPE: 400,
  FILE_TOO_LARGE: 400,
  UPLOAD_FAILED: 500,
  UPDATE_FAILED: 500,
}

function failure(error: string, status: number): NextResponse {
  return NextResponse.json({ success: false, data: null, error }, { status })
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return failure('UNAUTHORIZED', 401)

  let formData: FormData
  try {
    formData = await req.formData()
  } catch {
    return failure('VALIDATION_ERROR', 400)
  }

  const file = formData.get(AVATAR_FORM_FIELD)
  if (!file || !(file instanceof File)) return failure('VALIDATION_ERROR', 400)

  const result = await uploadAvatar(supabase, user.id, file)
  if (!result.success) {
    return failure(result.error, ERROR_STATUS[result.error] ?? 500)
  }
  return NextResponse.json({ success: true, data: result.data, error: null })
}

export async function DELETE(): Promise<NextResponse> {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return failure('UNAUTHORIZED', 401)

  const result = await removeAvatar(supabase, user.id)
  if (!result.success) {
    return failure(result.error, ERROR_STATUS[result.error] ?? 500)
  }
  return NextResponse.json({ success: true, data: result.data, error: null })
}
