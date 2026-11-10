import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/db/supabase-server'
import { removeExchangeAccount, toggleExchangeActive, updateExchangeApiKeys } from '@/lib/services/exchangeService'
import { UpdateExchangeActiveSchema, UpdateExchangeKeysSchema } from '@/lib/validators/exchange'
import { consumeValidationAttempt } from '@/lib/security/validationAttemptLimit'

async function getAuthenticatedUser(supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>) {
  const { data: { user } } = await supabase.auth.getUser()
  return user
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const supabase = await createSupabaseServerClient()
  const user = await getAuthenticatedUser(supabase)

  if (!user) {
    return NextResponse.json(
      { success: false, data: null, error: 'UNAUTHORIZED' },
      { status: 401 }
    )
  }

  const { id } = await params
  const result = await removeExchangeAccount(supabase, user.id, id)

  if (!result.success) {
    const status = result.error === 'NOT_FOUND' ? 404 : 500
    return NextResponse.json(
      { success: false, data: null, error: result.error },
      { status }
    )
  }

  return NextResponse.json({ success: true, data: result.data, error: null })
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const supabase = await createSupabaseServerClient()
  const user = await getAuthenticatedUser(supabase)

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

  const parsed = UpdateExchangeActiveSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, data: null, error: 'VALIDATION_ERROR' },
      { status: 400 }
    )
  }

  const { id } = await params
  const result = await toggleExchangeActive(supabase, user.id, id, parsed.data.is_active)

  if (!result.success) {
    const status = result.error === 'NOT_FOUND' ? 404 : 500
    return NextResponse.json(
      { success: false, data: null, error: result.error },
      { status }
    )
  }

  return NextResponse.json({ success: true, data: result.data, error: null })
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const supabase = await createSupabaseServerClient()
  const user = await getAuthenticatedUser(supabase)

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

  const parsed = UpdateExchangeKeysSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, data: null, error: 'VALIDATION_ERROR' },
      { status: 400 }
    )
  }

  const { id } = await params
  const { apiKey, apiSecret, passphrase, label } = parsed.data

  if (!consumeValidationAttempt(user.id)) {
    return NextResponse.json(
      { success: false, data: null, error: 'RATE_LIMITED' },
      { status: 429 }
    )
  }

  const result = await updateExchangeApiKeys(
    supabase,
    user.id,
    id,
    apiKey,
    apiSecret,
    passphrase,
    label === undefined ? undefined : (label ?? undefined)
  )

  if (!result.success) {
    const statusMap: Record<string, number> = {
      NOT_FOUND: 404,
      PASSPHRASE_REQUIRED: 400,
      INVALID_KEY: 400,
      INVALID_API_KEY: 400,
      INVALID_SECRET_OR_PASSPHRASE: 400,
      IP_NOT_WHITELISTED: 400,
      TRADE_PERMISSION_DETECTED: 400,
      WITHDRAW_PERMISSION_DETECTED: 400,
      TRANSFER_PERMISSION_DETECTED: 400,
      GEO_BLOCKED: 400,
      EXCHANGE_REGION_BLOCKED: 400,
      EXCHANGE_TIME_DRIFT: 400,
      RATE_LIMITED: 429,
      EXCHANGE_UNREACHABLE: 502,
      UNKNOWN: 502,
      UNSUPPORTED_EXCHANGE: 400,
      INTERNAL_ERROR: 500,
    }
    return NextResponse.json(
      { success: false, data: null, error: result.error },
      { status: statusMap[result.error] ?? 500 }
    )
  }

  return NextResponse.json({
    success: true,
    data: result.data.account,
    warnings: result.data.warnings,
    error: null,
  })
}
