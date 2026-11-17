import type { SupabaseClient, User } from '@supabase/supabase-js'
import type { Result } from '@/lib/types'
import { hasPasswordLogin } from '@/lib/auth/passwordIdentity'

export type ChangePasswordInput = {
  currentPassword: string
  newPassword: string
}

export type ChangePasswordDeps = {
  userClient: SupabaseClient
  createVerifierClient: () => SupabaseClient
}

const INVALID_CREDENTIALS_CODE = 'invalid_credentials'
const INVALID_CREDENTIALS_MESSAGE = 'invalid login credentials'
const WEAK_PASSWORD_CODE = 'weak_password'
const SAME_PASSWORD_CODE = 'same_password'
const RATE_LIMIT_STATUS = 429

type AuthFailure = { code?: string; message?: string; status?: number }

function isInvalidCredentials(error: AuthFailure): boolean {
  return (
    error.code === INVALID_CREDENTIALS_CODE ||
    (error.message ?? '').toLowerCase().includes(INVALID_CREDENTIALS_MESSAGE)
  )
}

export async function changePassword(
  user: Pick<User, 'email' | 'identities' | 'app_metadata'>,
  input: ChangePasswordInput,
  deps: ChangePasswordDeps
): Promise<Result<null>> {
  if (!user.email || !hasPasswordLogin(user)) {
    return { success: false, error: 'NO_PASSWORD_SET' }
  }

  const verifier = deps.createVerifierClient()
  const { error: verifyError } = await verifier.auth.signInWithPassword({
    email: user.email,
    password: input.currentPassword,
  })

  if (verifyError) {
    if (isInvalidCredentials(verifyError)) {
      return { success: false, error: 'INVALID_CURRENT_PASSWORD' }
    }
    if (verifyError.status === RATE_LIMIT_STATUS) {
      return { success: false, error: 'RATE_LIMITED' }
    }
    return { success: false, error: 'AUTH_UNAVAILABLE' }
  }

  await verifier.auth.signOut({ scope: 'local' }).catch(() => undefined)

  const { error: updateError } = await deps.userClient.auth.updateUser({
    password: input.newPassword,
  })

  if (updateError) {
    if (updateError.code === WEAK_PASSWORD_CODE) {
      return { success: false, error: 'WEAK_PASSWORD' }
    }
    if (updateError.code === SAME_PASSWORD_CODE) {
      return { success: false, error: 'SAME_PASSWORD' }
    }
    return { success: false, error: 'INTERNAL_ERROR' }
  }

  return { success: true, data: null }
}
