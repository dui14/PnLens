import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import {
  isExchangeDebugPath,
  isExchangeDebugVerifyEnabled,
} from '@/lib/security/exchangeDebugAccess'

type MiddlewareAuthUser = { id: string }

type MiddlewareAuthResponse = {
  data: {
    user: MiddlewareAuthUser | null
  }
}

const PROTECTED_ROUTES = [
  '/dashboard',
  '/demo-trading',
  '/ai-assistant',
  '/exchange',
  '/profile',
  '/api/exchange',
  '/api/pnl',
  '/api/demo',
  '/api/ai',
  '/api/profile',
]

const AUTH_ROUTES = ['/login', '/register']

function hasSupabaseAuthCookie(request: NextRequest): boolean {
  return request.cookies
    .getAll()
    .some(({ name }) => name.startsWith('sb-') && name.includes('-auth-token'))
}

async function getUserWithRetry(
  fetchUser: () => Promise<MiddlewareAuthResponse>,
  retries: number
): Promise<MiddlewareAuthUser | null> {
  let lastError: unknown = null

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const result = await fetchUser()
      return result.data.user
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
  const hasAuthCookie = hasSupabaseAuthCookie(request)

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
            cookiesToSet.forEach(({ name, value, options }) =>
              response.cookies.set(name, value, options)
            )
          },
        },
      }
    )

    user = await getUserWithRetry(() => supabase.auth.getUser(), 1)
  } catch (error) {
    authUnavailable = true
    console.error('[middleware] auth check failed', error)
  }

  if (isProtected && !user && authUnavailable && hasAuthCookie) {
    return response
  }

  if (isProtected && !user && authUnavailable && isApiRoute) {
    return NextResponse.json(
      { success: false, data: null, error: 'AUTH_SERVICE_UNAVAILABLE' },
      { status: 503 }
    )
  }

  if (isProtected && !user && isApiRoute) {
    return NextResponse.json(
      { success: false, data: null, error: 'UNAUTHORIZED' },
      { status: 401 }
    )
  }

  if (isProtected && !user && !isApiRoute) {
    const loginUrl = new URL('/login', request.url)
    loginUrl.searchParams.set('next', pathname)
    return NextResponse.redirect(loginUrl)
  }

  if (isAuthRoute && user) {
    return NextResponse.redirect(new URL('/dashboard', request.url))
  }

  return response
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
