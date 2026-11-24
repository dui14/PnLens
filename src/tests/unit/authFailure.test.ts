import { describe, expect, it } from 'vitest'
import { classifyAuthFailure, describeAuthFailure, isDeadSession } from '@/lib/auth/authFailure'

describe('classifyAuthFailure', () => {
  it('treats refresh token codes as signed out', () => {
    expect(classifyAuthFailure({ code: 'refresh_token_not_found' })).toBe('signed_out')
    expect(classifyAuthFailure({ code: 'refresh_token_already_used' })).toBe('signed_out')
  })

  it('treats invalid refresh token messages as signed out', () => {
    expect(
      classifyAuthFailure({ name: 'AuthApiError', message: 'Invalid Refresh Token: Already Used', status: 400 })
    ).toBe('signed_out')
  })

  it('treats missing session as signed out', () => {
    expect(classifyAuthFailure({ name: 'AuthSessionMissingError' })).toBe('signed_out')
  })

  it('treats network style failures as unavailable', () => {
    expect(classifyAuthFailure({ name: 'AuthRetryableFetchError', status: 0 })).toBe('unavailable')
    expect(classifyAuthFailure(null)).toBe('unavailable')
  })

  it('describes errors with code', () => {
    const error = Object.assign(new Error('boom'), { code: 'x' })
    expect(describeAuthFailure(error)).toBe('Error(x): boom')
  })
})

describe('isDeadSession', () => {
  it('is true only for definitive dead sessions', () => {
    expect(isDeadSession({ code: 'refresh_token_not_found' })).toBe(true)
    expect(isDeadSession({ code: 'session_expired' })).toBe(true)
    expect(isDeadSession({ code: 'bad_jwt' })).toBe(true)
  })

  it('is false for already used tokens', () => {
  })

  it('is false for already used tokens', () => {
    expect(isDeadSession({ code: 'refresh_token_already_used' })).toBe(false)
    expect(isDeadSession({ message: 'Invalid Refresh Token: Already Used' })).toBe(false)
    expect(isDeadSession(null)).toBe(false)
  })
})
