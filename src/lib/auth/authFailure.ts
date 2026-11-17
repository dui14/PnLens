export type AuthFailureKind = 'signed_out' | 'unavailable'

export type AuthFailureShape = {
  name?: string
  message?: string
  code?: string
  status?: number
}

const SIGNED_OUT_CODES = new Set([
  'refresh_token_not_found',
  'refresh_token_already_used',
  'session_not_found',
  'session_expired',
  'bad_jwt',
  'user_not_found',
])

const SIGNED_OUT_NAMES = new Set(['AuthSessionMissingError', 'AuthInvalidJwtError'])

const SIGNED_OUT_MESSAGE_PATTERN = /invalid refresh token|refresh token not found|already used/i

const SIGNED_OUT_STATUSES = new Set([400, 401, 403])

const DEAD_SESSION_CODES = new Set([
  'refresh_token_not_found',
  'session_not_found',
  'session_expired',
  'user_not_found',
  'bad_jwt',
])

const DEAD_SESSION_MESSAGE_PATTERN = /refresh token not found/i

export function isDeadSession(error: AuthFailureShape | null | undefined): boolean {
  if (!error) return false
  if (error.code && DEAD_SESSION_CODES.has(error.code)) return true
  return Boolean(error.message && DEAD_SESSION_MESSAGE_PATTERN.test(error.message))
}

export function classifyAuthFailure(error: AuthFailureShape | null | undefined): AuthFailureKind {
  if (!error) return 'unavailable'
  if (error.code && SIGNED_OUT_CODES.has(error.code)) return 'signed_out'
  if (error.name && SIGNED_OUT_NAMES.has(error.name)) return 'signed_out'
  if (error.message && SIGNED_OUT_MESSAGE_PATTERN.test(error.message)) return 'signed_out'
  if (error.name === 'AuthApiError' && error.status && SIGNED_OUT_STATUSES.has(error.status)) {
    return 'signed_out'
  }
  return 'unavailable'
}

export function describeAuthFailure(error: unknown): string {
  if (error instanceof Error) {
    const code = (error as AuthFailureShape).code
    return `${error.name}${code ? `(${code})` : ''}: ${error.message}`
  }
  return String(error)
}
