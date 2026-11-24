import { NextRequest, NextResponse } from 'next/server'
import {
  createSupabaseServerClient,
  createSupabaseVerifierClient,
} from '@/lib/db/supabase-server'
import { buildChangePasswordSchema } from '@/lib/validators/auth'
import { changePassword } from '@/lib/services/passwordService'

const VALIDATION_MESSAGES = {
  currentRequired: 'CURRENT_PASSWORD_REQUIRED',
  passwordMin: 'PASSWORD_TOO_SHORT',
  passwordMismatch: 'PASSWORD_MISMATCH',
  sameAsCurrent: 'SAME_PASSWORD',
}

const ERROR_STATUS: Record<string, number> = {
  INVALID_CURRENT_PASSWORD: 400,
  NO_PASSWORD_SET: 400,
  WEAK_PASSWORD: 400,
  SAME_PASSWORD: 400,
  RATE_LIMITED: 429,
  AUTH_UNAVAILABLE: 503,
}
const DEFAULT_ERROR_STATUS = 500

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

  const parsed = buildChangePasswordSchema(VALIDATION_MESSAGES).safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      {
        success: false,
        data: null,
        error: parsed.error.issues[0]?.message ?? 'VALIDATION_ERROR',
      },
      { status: 400 }
    )
  }

  const result = await changePassword(
    user,
    {
      currentPassword: parsed.data.currentPassword,
      newPassword: parsed.data.newPassword,
    },
    { userClient: supabase, createVerifierClient: createSupabaseVerifierClient }
  )

  if (!result.success) {
    return NextResponse.json(
      { success: false, data: null, error: result.error },
      { status: ERROR_STATUS[result.error] ?? DEFAULT_ERROR_STATUS }
    )
  }

  return NextResponse.json({ success: true, data: null, error: null })
}
