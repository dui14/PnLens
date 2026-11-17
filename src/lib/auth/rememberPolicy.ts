import type { CookieOptions } from '@supabase/ssr'
import {
  REMEMBER_COOKIE_MAX_AGE_SECONDS,
  REMEMBER_COOKIE_NAME,
  REMEMBER_DISABLED_VALUE,
  REMEMBER_ENABLED_VALUE,
  SUPABASE_COOKIE_PREFIX,
} from '@/lib/auth/constants'

export function isRememberDisabled(preference: string | null | undefined): boolean {
  return preference === REMEMBER_DISABLED_VALUE
}

export function applyRememberPolicy(
  name: string,
  options: CookieOptions,
  rememberDisabled: boolean
): CookieOptions {
  if (!rememberDisabled || !name.startsWith(SUPABASE_COOKIE_PREFIX)) return options
  if (options.maxAge !== undefined && options.maxAge <= 0) return options
  if (options.expires && options.expires.getTime() <= Date.now()) return options
  const sessionOptions = { ...options }
  delete sessionOptions.maxAge
  delete sessionOptions.expires
  return sessionOptions
}

export function readRememberPreferenceFromDocument(cookieHeader: string): string | null {
  const prefix = `${REMEMBER_COOKIE_NAME}=`
  const match = cookieHeader.split('; ').find((entry) => entry.startsWith(prefix))
  return match ? decodeURIComponent(match.slice(prefix.length)) : null
}

export function writeRememberPreference(remember: boolean): void {
  if (typeof document === 'undefined') return
  if (remember) {
    document.cookie = `${REMEMBER_COOKIE_NAME}=${REMEMBER_ENABLED_VALUE}; path=/; max-age=${REMEMBER_COOKIE_MAX_AGE_SECONDS}; samesite=lax`
    return
  }
  document.cookie = `${REMEMBER_COOKIE_NAME}=${REMEMBER_DISABLED_VALUE}; path=/; samesite=lax`
}
