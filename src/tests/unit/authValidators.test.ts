import { describe, expect, it } from 'vitest'
import {
  PASSWORD_MIN_LENGTH,
  buildChangePasswordSchema,
  buildForgotPasswordSchema,
  buildPasswordSchema,
  buildResetPasswordSchema,
} from '@/lib/validators/auth'

const messages = { passwordMin: 'too short', passwordMismatch: 'no match' }

describe('auth validators', () => {
  it('enforces the minimum password length', () => {
    const schema = buildPasswordSchema('too short')
    expect(schema.safeParse('a'.repeat(PASSWORD_MIN_LENGTH - 1)).success).toBe(false)
    expect(schema.safeParse('a'.repeat(PASSWORD_MIN_LENGTH)).success).toBe(true)
  })

  it('rejects mismatched reset passwords on confirmPassword', () => {
    const result = buildResetPasswordSchema(messages).safeParse({
      password: 'longenough1',
      confirmPassword: 'different11',
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(['confirmPassword'])
      expect(result.error.issues[0]?.message).toBe('no match')
    }
  })

  it('accepts matching reset passwords', () => {
    const result = buildResetPasswordSchema(messages).safeParse({
      password: 'longenough1',
      confirmPassword: 'longenough1',
    })
    expect(result.success).toBe(true)
  })

  it('validates the forgot-password email', () => {
    const schema = buildForgotPasswordSchema('bad email')
    expect(schema.safeParse({ email: 'nope' }).success).toBe(false)
    expect(schema.safeParse({ email: 'a@b.co' }).success).toBe(true)
  })
})

describe('change password validator', () => {
  const schema = buildChangePasswordSchema({
    currentRequired: 'current required',
    passwordMin: 'too short',
    passwordMismatch: 'no match',
    sameAsCurrent: 'same',
  })
  const valid = {
    currentPassword: 'oldpassword1',
    newPassword: 'newpassword1',
    confirmPassword: 'newpassword1',
  }

  it('accepts a valid change', () => {
    expect(schema.safeParse(valid).success).toBe(true)
  })

  it('requires the current password', () => {
    const result = schema.safeParse({ ...valid, currentPassword: '' })
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error.issues[0]?.message).toBe('current required')
  })

  it('rejects a short new password', () => {
    expect(
      schema.safeParse({ ...valid, newPassword: 'short', confirmPassword: 'short' }).success
    ).toBe(false)
  })

  it('rejects mismatched confirmation', () => {
    const result = schema.safeParse({ ...valid, confirmPassword: 'newpassword2' })
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(['confirmPassword'])
  })

  it('rejects a new password equal to the current one', () => {
    const result = schema.safeParse({
      currentPassword: 'samepassword1',
      newPassword: 'samepassword1',
      confirmPassword: 'samepassword1',
    })
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(['newPassword'])
  })
})
