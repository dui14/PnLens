import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { decideMiddlewareAccess } from '../src/lib/security/middlewareAccess.ts'

const middlewareSource = readFileSync(new URL('../src/middleware.ts', import.meta.url), 'utf8')

test('a supabase auth cookie never authorizes a protected request', () => {
  assert.equal(middlewareSource.includes('auth-token'), false)
  assert.equal(middlewareSource.includes('hasSupabaseAuthCookie'), false)
  assert.equal(middlewareSource.includes('hasAuthCookie'), false)

  const thrown = {
    isProtected: true,
    isAuthRoute: false,
    isApiRoute: true,
    userPresent: false,
    authUnavailable: true,
  } as const

  assert.equal(decideMiddlewareAccess(thrown), 'auth_unavailable')
  assert.equal(
    decideMiddlewareAccess({ ...thrown, isApiRoute: false }),
    'redirect_login'
  )
})

test('auth failure stays fail-closed for protected API and pages', () => {
  assert.equal(
    decideMiddlewareAccess({
      isProtected: true,
      isAuthRoute: false,
      isApiRoute: true,
      userPresent: false,
      authUnavailable: false,
    }),
    'unauthorized'
  )
  assert.equal(
    decideMiddlewareAccess({
      isProtected: true,
      isAuthRoute: false,
      isApiRoute: false,
      userPresent: false,
      authUnavailable: false,
    }),
    'redirect_login'
  )
  assert.equal(
    decideMiddlewareAccess({
      isProtected: true,
      isAuthRoute: false,
      isApiRoute: true,
      userPresent: true,
      authUnavailable: false,
    }),
    'continue'
  )
  assert.equal(
    decideMiddlewareAccess({
      isProtected: false,
      isAuthRoute: true,
      isApiRoute: false,
      userPresent: true,
      authUnavailable: false,
    }),
    'redirect_dashboard'
  )
  assert.equal(
    decideMiddlewareAccess({
      isProtected: false,
      isAuthRoute: true,
      isApiRoute: false,
      userPresent: false,
      authUnavailable: true,
    }),
    'continue'
  )
})

test('the production debug script is not in the tree', () => {
  assert.equal(middlewareSource.includes('track-pnl.duii.dev'), false)
  let script = ''
  try {
    script = readFileSync(
      new URL('../src/scripts/tmp-prod-exchange-debug.cjs', import.meta.url),
      'utf8'
    )
  } catch (error) {
    assert.equal((error as NodeJS.ErrnoException).code, 'ENOENT')
    return
  }
  assert.fail(`tmp-prod-exchange-debug.cjs is still present:\n${script.slice(0, 80)}`)
})
