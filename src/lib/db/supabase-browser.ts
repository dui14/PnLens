'use client'

import {
  createBrowserClient,
  type CookieOptions,
  parseCookieHeader,
  serializeCookieHeader,
} from '@supabase/ssr'
import {
  applyRememberPolicy,
  isRememberDisabled,
  readRememberPreferenceFromDocument,
} from '@/lib/auth/rememberPolicy'

export function createSupabaseBrowserClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return parseCookieHeader(document.cookie).map(({ name, value }) => ({
            name,
            value: value ?? '',
          }))
        },
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          const disabled = isRememberDisabled(readRememberPreferenceFromDocument(document.cookie))
          cookiesToSet.forEach(({ name, value, options }) => {
            document.cookie = serializeCookieHeader(
              name,
              value,
              applyRememberPolicy(name, options, disabled)
            )
          })
        },
      },
    }
  )
}
