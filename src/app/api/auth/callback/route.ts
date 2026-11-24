import { createServerClient, type CookieOptions } from '@supabase/ssr'
import type { EmailOtpType } from '@supabase/supabase-js'
import { NextResponse, type NextRequest } from 'next/server'
import { REMEMBER_COOKIE_NAME } from '@/lib/auth/constants'
import { applyRememberPolicy, isRememberDisabled } from '@/lib/auth/rememberPolicy'
import { resolveSafeNextPath } from '@/lib/security/safeNextPath'

function getAppOrigin(request: NextRequest): string {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL
  if (appUrl) {
    try {
      return new URL(appUrl).origin
    } catch {}
  }

  const forwardedHost = request.headers.get('x-forwarded-host')
  if (forwardedHost) {
    const host = forwardedHost.split(',')[0]?.trim()
    if (host) {
      const forwardedProto = request.headers.get('x-forwarded-proto')
      const protocol = forwardedProto?.split(',')[0]?.trim() || 'https'
      return `${protocol}://${host}`
    }
  }

  return new URL(request.url).origin
}

const RESET_PASSWORD_PATH = '/reset-password'

function getFailureRedirect(nextPath: string, appOrigin: string): URL {
  if (nextPath === RESET_PASSWORD_PATH) {
    return new URL(`${RESET_PASSWORD_PATH}?error=invalid_link`, appOrigin)
  }
  return new URL('/login?error=auth_failed', appOrigin)
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(request.url)
  const appOrigin = getAppOrigin(request)
  const code = searchParams.get('code')
  const tokenHash = searchParams.get('token_hash')
  const type = searchParams.get('type')
  const nextPath = resolveSafeNextPath(searchParams.get('next'), appOrigin)

  if (!code && (!tokenHash || !type)) {
    return NextResponse.redirect(
      nextPath === RESET_PASSWORD_PATH
        ? getFailureRedirect(nextPath, appOrigin)
        : new URL('/login?error=missing_token', appOrigin)
    )
  }

  const response = NextResponse.redirect(new URL(nextPath, appOrigin))

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          const disabled = isRememberDisabled(request.cookies.get(REMEMBER_COOKIE_NAME)?.value)
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, applyRememberPolicy(name, options, disabled))
          )
        },
      },
    }
  )

  let error: Error | null = null

  if (code) {
    const result = await supabase.auth.exchangeCodeForSession(code)
    error = result.error
  } else if (tokenHash && type) {
    const result = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type: type as EmailOtpType,
    })
    error = result.error
  }

  if (error) {
    return NextResponse.redirect(new URL('/login?error=auth_failed', appOrigin))
  }

  return response
}
