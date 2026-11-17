import type { User } from '@supabase/supabase-js'
import { EMAIL_PROVIDER } from '@/lib/auth/constants'

export function hasPasswordLogin(
  user: Pick<User, 'identities' | 'app_metadata'>
): boolean {
  const providers = user.app_metadata?.providers
  if (Array.isArray(providers) && providers.includes(EMAIL_PROVIDER)) return true
  if (user.app_metadata?.provider === EMAIL_PROVIDER) return true
  return (user.identities ?? []).some((identity) => identity.provider === EMAIL_PROVIDER)
}
