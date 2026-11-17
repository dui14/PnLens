import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { REMEMBER_COOKIE_NAME, SUPABASE_COOKIE_PREFIX } from '@/lib/auth/constants'
import { classifyAuthFailure, describeAuthFailure, isDeadSession, type AuthFailureShape } from '@/lib/auth/authFailure'
import { applyRememberPolicy, isRememberDisabled } from '@/lib/auth/rememberPolicy'
import { decideMiddlewareAccess } from '@/lib/security/middlewareAccess'
import {
  isExchangeDebugPath,
  isExchangeDebugVerifyEnabled,
} from '@/lib/security/exchangeDebugAccess'

type MiddlewareAuthUser = { id: string }

type MiddlewareAuthResponse = {
  data: {
    user: MiddlewareAuthUser | null
  }
  error?: AuthFailureShape | null
}

type MiddlewareAuthResult = {
  user: MiddlewareAuthUser | null
  signedOutByError: boolean
}

const PROTECTED_ROUTES = [
  '/dashboard',
  '/demo-trading',
  '/ai-assistant',
  '/exchange',
  '/settings',
  '/api/exchange',
  '/api/pnl',
  '/api/demo',
  '/api/ai',
  '/api/settings',
]

const AUTH_ROUTES = ['/login', '/register', '/forgot-password']

async function getUserWithRetry(
  fetchUser: () => Promise<MiddlewareAuthResponse>,
  retries: number
): Promise<MiddlewareAuthResult> {
  let lastError: unknown = null

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const result = await fetchUser()
      if (result.data.user) return { user: result.data.user, signedOutByError: false }
      if (result.error && classifyAuthFailure(result.error) === 'unavailable') {
        lastError = result.error
        continue
      }
      return { user: null, signedOutByError: isDeadSession(result.error) }
    } catch (error) {
      lastError = error
    }
  }

  throw lastError instanceof Error ? lastError : new Error('AUTH_FETCH_FAILED')
}

export async function middleware(request: NextRequest): Promise<NextResponse> {
  let response = NextResponse.next({ request })
  const { pathname } = request.nextUrl
  const isProtected = PROTECTED_ROUTES.some((route) => pathname.startsWith(route))
  const isAuthRoute = AUTH_ROUTES.some((route) => pathname.startsWith(route))
  const isApiRoute = pathname.startsWith('/api/')
  if (isApiRoute && request.method !== 'GET' && request.method !== 'HEAD') {
    const contentLength = request.headers.get('content-length')
    if (contentLength && Number(contentLength) > 1024 * 1024) {
      return NextResponse.json(
        { success: false, data: null, error: 'PAYLOAD_TOO_LARGE' },
        { status: 413 }
      )
    }
  }

  if (isExchangeDebugPath(pathname) && !isExchangeDebugVerifyEnabled(process.env)) {
    return NextResponse.json(
      { success: false, data: null, error: 'NOT_FOUND' },
      { status: 404 }
    )
  }

  if (!isProtected && !isAuthRoute) {
    return response
  }

  let user: { id: string } | null = null
  let authUnavailable = false
  let clearAuthCookies = false

  try {
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return request.cookies.getAll()
          },
          setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
            cookiesToSet.forEach(({ name, value }) =>
              request.cookies.set(name, value)
            )
            response = NextResponse.next({ request })
            const disabled = isRememberDisabled(request.cookies.get(REMEMBER_COOKIE_NAME)?.value)
            cookiesToSet.forEach(({ name, value, options }) =>
              response.cookies.set(name, value, applyRememberPolicy(name, options, disabled))
            )
          },
        },
      }
    )

    const result = await getUserWithRetry(() => supabase.auth.getUser(), 1)
    user = result.user
    clearAuthCookies = result.signedOutByError
  } catch (error) {
    authUnavailable = true
    console.error(`[middleware] auth check failed: ${describeAuthFailure(error)}`)
  }

  const clearStaleSession = (target: NextResponse): NextResponse => {
    if (!clearAuthCookies) return target
    request.cookies
      .getAll()
      .filter(({ name }) => name.startsWith(SUPABASE_COOKIE_PREFIX))
      .forEach(({ name }) => target.cookies.set(name, '', { path: '/', maxAge: 0 }))
    return target
  }

  const decision = decideMiddlewareAccess({
    isProtected,
    isAuthRoute,
    isApiRoute,
    userPresent: user !== null,
    authUnavailable,
  })

  if (decision === 'auth_unavailable') {
    return NextResponse.json(
      { success: false, data: null, error: 'AUTH_SERVICE_UNAVAILABLE' },
      { status: 503 }
    )
  }

  if (decision === 'unauthorized') {
    return clearStaleSession(
      NextResponse.json({ success: false, data: null, error: 'UNAUTHORIZED' }, { status: 401 })
    )
  }

  if (decision === 'redirect_login') {
    const loginUrl = new URL('/login', request.url)
    loginUrl.searchParams.set('next', pathname)
    return clearStaleSession(NextResponse.redirect(loginUrl))
  }

  if (decision === 'redirect_dashboard') {
    return NextResponse.redirect(new URL('/dashboard', request.url))
  }

  return response
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
