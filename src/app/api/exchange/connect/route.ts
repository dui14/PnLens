import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/db/supabase-server'
import { ConnectExchangeSchema, exchangeKeyErrorCode } from '@/lib/validators/exchange'
import { connectExchange } from '@/lib/services/exchangeService'
import { consumeValidationAttempt } from '@/lib/security/validationAttemptLimit'

const CONNECT_ERROR_STATUS: Record<string, number> = {
  CONFLICT: 409,
  PASSPHRASE_REQUIRED: 400,
  VALIDATION_ERROR: 400,
  INVALID_KEY: 400,
  INVALID_SECRET_OR_PASSPHRASE: 400,
  PRIVATE_KEY_INVALID: 400,
  PRIVATE_KEY_ALGORITHM_UNSUPPORTED: 400,
  IP_NOT_WHITELISTED: 400,
  TRADE_PERMISSION_DETECTED: 400,
  WITHDRAW_PERMISSION_DETECTED: 400,
  TRANSFER_PERMISSION_DETECTED: 400,
  GEO_BLOCKED: 400,
  RATE_LIMITED: 429,
  EXCHANGE_TIME_DRIFT: 400,
  EXCHANGE_UNREACHABLE: 502,
  UNKNOWN: 502,
  UNSUPPORTED_EXCHANGE: 400,
  INTERNAL_ERROR: 500,
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  let supabase
  let user
  try {
    supabase = await createSupabaseServerClient()
    const authResult = await supabase.auth.getUser()
    user = authResult.data.user
  } catch (error) {
    console.error('[exchange/connect] auth service unavailable:', error)
    return NextResponse.json(
      { success: false, data: null, error: 'AUTH_SERVICE_UNAVAILABLE' },
      { status: 503 }
    )
  }

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

  const parsed = ConnectExchangeSchema.safeParse(body)
  if (!parsed.success) {
    const passphraseRequired = parsed.error.issues.some((issue) => issue.message === 'PASSPHRASE_REQUIRED')
    return NextResponse.json(
      { success: false, data: null, error: passphraseRequired ? 'PASSPHRASE_REQUIRED' : exchangeKeyErrorCode(parsed.error) },
      { status: 400 }
    )
  }

  const { exchange, apiKey, apiSecret, passphrase, label } = parsed.data

  if (!process.env.ENCRYPTION_MASTER_KEY) {
    return NextResponse.json(
      { success: false, data: null, error: 'ENCRYPTION_NOT_CONFIGURED' },
      { status: 500 }
    )
  }

  if (!consumeValidationAttempt(user.id)) {
    return NextResponse.json(
      { success: false, data: null, error: 'RATE_LIMITED' },
      { status: 429 }
    )
  }

  let result
  try {
    result = await connectExchange(
      supabase,
      user.id,
      exchange,
      apiKey,
      apiSecret ?? '',
      passphrase,
      label
    )
  } catch (error) {
    console.error('[exchange/connect] unexpected error:', error)

    const isEncryptionError =
      error instanceof Error && error.message.includes('ENCRYPTION_MASTER_KEY')

    return NextResponse.json(
      {
        success: false,
        data: null,
        error: isEncryptionError ? 'ENCRYPTION_NOT_CONFIGURED' : 'INTERNAL_ERROR',
      },
      { status: 500 }
    )
  }

  if (!result.success) {
    return NextResponse.json(
      { success: false, data: null, error: result.error },
      { status: CONNECT_ERROR_STATUS[result.error] ?? 500 }
    )
  }

  return NextResponse.json(
    { success: true, data: result.data.account, warnings: result.data.warnings, error: null },
    { status: 201 }
  )
}
