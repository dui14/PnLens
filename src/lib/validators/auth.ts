import { z } from 'zod'

export const PASSWORD_MIN_LENGTH = 8

export function buildPasswordSchema(message: string) {
  return z.string().min(PASSWORD_MIN_LENGTH, message)
}

export function buildResetPasswordSchema(messages: {
  passwordMin: string
  passwordMismatch: string
}) {
  return z
    .object({
      password: buildPasswordSchema(messages.passwordMin),
      confirmPassword: z.string(),
    })
    .refine((data) => data.password === data.confirmPassword, {
      message: messages.passwordMismatch,
      path: ['confirmPassword'],
    })
}

export function buildForgotPasswordSchema(emailMessage: string) {
  return z.object({ email: z.string().email(emailMessage) })
}

export function buildChangePasswordSchema(messages: {
  currentRequired: string
  passwordMin: string
  passwordMismatch: string
  sameAsCurrent: string
}) {
  return z
    .object({
      currentPassword: z.string().min(1, messages.currentRequired),
      newPassword: buildPasswordSchema(messages.passwordMin),
      confirmPassword: z.string(),
    })
    .refine((data) => data.newPassword === data.confirmPassword, {
      message: messages.passwordMismatch,
      path: ['confirmPassword'],
    })
    .refine((data) => data.newPassword !== data.currentPassword, {
      message: messages.sameAsCurrent,
      path: ['newPassword'],
    })
}
