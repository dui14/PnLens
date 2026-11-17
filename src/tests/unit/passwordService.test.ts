import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { changePassword } from '@/lib/services/passwordService'
import { applyRememberPolicy, isRememberDisabled } from '@/lib/auth/rememberPolicy'
import { hasPasswordLogin } from '@/lib/auth/passwordIdentity'

type AuthError = { code?: string; message?: string; status?: number } | null

function makeDeps(opts: { signIn?: AuthError; update?: AuthError }) {
  const signInWithPassword = vi.fn(async () => ({ error: opts.signIn ?? null }))
  const signOut = vi.fn(async () => ({ error: null }))
  const updateUser = vi.fn(async () => ({ error: opts.update ?? null }))
  const userSignOut = vi.fn()
  const verifier = { auth: { signInWithPassword, signOut } } as unknown as SupabaseClient
  const userClient = { auth: { updateUser, signOut: userSignOut } } as unknown as SupabaseClient
  return {
    deps: { userClient, createVerifierClient: () => verifier },
    signInWithPassword,
    signOut,
    updateUser,
    userSignOut,
  }
}

const passwordUser = {
  email: 'a@b.com',
  identities: [{ provider: 'email' }],
  app_metadata: { provider: 'email', providers: ['email'] },
} as never

const googleUser = {
  email: 'a@b.com',
  identities: [{ provider: 'google' }],
  app_metadata: { provider: 'google', providers: ['google'] },
} as never

const input = { currentPassword: 'oldpassword1', newPassword: 'newpassword1' }

describe('changePassword', () => {
  it('verifies on a throwaway client, signs it out locally, then updates the user', async () => {
    const ctx = makeDeps({})
    const result = await changePassword(passwordUser, input, ctx.deps)
    expect(result).toEqual({ success: true, data: null })
    expect(ctx.signInWithPassword).toHaveBeenCalledWith({
      email: 'a@b.com',
      password: 'oldpassword1',
    })
    expect(ctx.signOut).toHaveBeenCalledWith({ scope: 'local' })
    expect(ctx.updateUser).toHaveBeenCalledWith({ password: 'newpassword1' })
    expect(ctx.userSignOut).not.toHaveBeenCalled()
  })

  it('returns INVALID_CURRENT_PASSWORD and never updates', async () => {
    const ctx = makeDeps({ signIn: { code: 'invalid_credentials', status: 400 } })
    const result = await changePassword(passwordUser, input, ctx.deps)
    expect(result).toEqual({ success: false, error: 'INVALID_CURRENT_PASSWORD' })
    expect(ctx.updateUser).not.toHaveBeenCalled()
  })

  it('maps rate limiting and outages', async () => {
    const limited = makeDeps({ signIn: { status: 429, message: 'slow down' } })
    expect(await changePassword(passwordUser, input, limited.deps)).toEqual({
      success: false,
      error: 'RATE_LIMITED',
    })
    const down = makeDeps({ signIn: { status: 500, message: 'boom' } })
    expect(await changePassword(passwordUser, input, down.deps)).toEqual({
      success: false,
      error: 'AUTH_UNAVAILABLE',
    })
  })

  it('maps update failures', async () => {
    const weak = makeDeps({ update: { code: 'weak_password' } })
    expect(await changePassword(passwordUser, input, weak.deps)).toEqual({
      success: false,
      error: 'WEAK_PASSWORD',
    })
    const same = makeDeps({ update: { code: 'same_password' } })
    expect(await changePassword(passwordUser, input, same.deps)).toEqual({
      success: false,
      error: 'SAME_PASSWORD',
    })
    const other = makeDeps({ update: { message: 'x' } })
    expect(await changePassword(passwordUser, input, other.deps)).toEqual({
      success: false,
      error: 'INTERNAL_ERROR',
    })
  })

  it('rejects Google-only accounts without touching auth', async () => {
    const ctx = makeDeps({})
    const result = await changePassword(googleUser, input, ctx.deps)
    expect(result).toEqual({ success: false, error: 'NO_PASSWORD_SET' })
    expect(ctx.signInWithPassword).not.toHaveBeenCalled()
  })
})

describe('hasPasswordLogin', () => {
  it('detects email identities and providers', () => {
    expect(hasPasswordLogin(passwordUser)).toBe(true)
    expect(hasPasswordLogin(googleUser)).toBe(false)
    expect(
      hasPasswordLogin({
        identities: [],
        app_metadata: { providers: ['google', 'email'] },
      } as never)
    ).toBe(true)
  })
})

describe('applyRememberPolicy', () => {
  const persistent = { path: '/', maxAge: 400, expires: new Date(Date.now() + 1000) }

  it('drops persistence for sb- cookies when remember is off', () => {
    expect(applyRememberPolicy('sb-x-auth-token', persistent, true)).toEqual({ path: '/' })
  })

  it('keeps options when remember is on or the cookie is not an auth cookie', () => {
    expect(applyRememberPolicy('sb-x-auth-token', persistent, false)).toBe(persistent)
    expect(applyRememberPolicy('other', persistent, true)).toBe(persistent)
  })

  it('keeps deletion cookies expiring', () => {
    const removal = { path: '/', maxAge: 0 }
    expect(applyRememberPolicy('sb-x-auth-token', removal, true)).toBe(removal)
  })

  it('reads the preference value', () => {
    expect(isRememberDisabled('0')).toBe(true)
    expect(isRememberDisabled('1')).toBe(false)
    expect(isRememberDisabled(undefined)).toBe(false)
  })
})
