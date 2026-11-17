import type { AiProviderStatus } from '@/lib/types'

export const AI_CHAT_ERROR_CODES = [
  'AI_KEY_INVALID',
  'AI_KEY_EXPIRED',
  'AI_INSUFFICIENT_CREDITS',
  'AI_RATE_LIMITED',
  'AI_PROVIDER_UNAVAILABLE',
  'AI_MODEL_NOT_FOUND',
  'AI_PROVIDER_KEY_MISSING',
  'AI_MODEL_NOT_ALLOWED',
  'AI_UNKNOWN_ERROR',
] as const

export type AiChatErrorCode = (typeof AI_CHAT_ERROR_CODES)[number]

export const AI_REQUEST_FAILED_PREFIX = 'AI_REQUEST_FAILED'
export const AI_CHAT_ERROR_FALLBACK: AiChatErrorCode = 'AI_UNKNOWN_ERROR'

const HTTP_UNAUTHORIZED = 401
const HTTP_PAYMENT_REQUIRED = 402
const HTTP_FORBIDDEN = 403
const HTTP_NOT_FOUND = 404
const HTTP_TOO_MANY_REQUESTS = 429
const HTTP_SERVER_ERROR_MIN = 500
const HTTP_SERVER_ERROR_MAX = 599

const CREDITS_PATTERN = /insufficient|quota|credit|billing|balance/i
const EXPIRED_PATTERN = /expired/i
const TRANSIENT_PATTERN = /fetch failed|network|timeout|timed out|abort|econn|enotfound|socket|terminated/i
const TIMEOUT_CODES = new Set(['AGENT_LOOP_TIMEOUT', 'STREAM_TERMINATED'])

const KEY_STATUS_BY_CODE: Partial<Record<AiChatErrorCode, AiProviderStatus>> = {
  AI_KEY_INVALID: 'invalid',
  AI_KEY_EXPIRED: 'expired',
  AI_RATE_LIMITED: 'rate_limited',
  AI_INSUFFICIENT_CREDITS: 'insufficient_credits',
}

const PASS_THROUGH = new Set<string>(AI_CHAT_ERROR_CODES)

export function isAiChatErrorCode(value: unknown): value is AiChatErrorCode {
  return typeof value === 'string' && PASS_THROUGH.has(value)
}

function classifyHttpStatus(status: number, body: string): AiChatErrorCode {
  if (status === HTTP_UNAUTHORIZED) {
    return EXPIRED_PATTERN.test(body) ? 'AI_KEY_EXPIRED' : 'AI_KEY_INVALID'
  }
  if (status === HTTP_FORBIDDEN) return 'AI_KEY_EXPIRED'
  if (status === HTTP_PAYMENT_REQUIRED) return 'AI_INSUFFICIENT_CREDITS'
  if (status === HTTP_NOT_FOUND) return 'AI_MODEL_NOT_FOUND'
  if (status === HTTP_TOO_MANY_REQUESTS) {
    return CREDITS_PATTERN.test(body) ? 'AI_INSUFFICIENT_CREDITS' : 'AI_RATE_LIMITED'
  }
  if (status >= HTTP_SERVER_ERROR_MIN && status <= HTTP_SERVER_ERROR_MAX) {
    return 'AI_PROVIDER_UNAVAILABLE'
  }
  return AI_CHAT_ERROR_FALLBACK
}

export function classifyAiError(raw: unknown): AiChatErrorCode {
  const text = raw instanceof Error ? raw.message : typeof raw === 'string' ? raw : ''
  if (isAiChatErrorCode(text)) return text

  const prefix = `${AI_REQUEST_FAILED_PREFIX}:`
  if (text.startsWith(prefix)) {
    const rest = text.slice(prefix.length)
    const separator = rest.indexOf(':')
    const statusText = separator >= 0 ? rest.slice(0, separator) : rest
    const body = separator >= 0 ? rest.slice(separator + 1) : ''
    const status = Number.parseInt(statusText, 10)
    if (Number.isFinite(status)) return classifyHttpStatus(status, body)
    return AI_CHAT_ERROR_FALLBACK
  }

  const code = text.split(':')[0]
  if (TIMEOUT_CODES.has(code)) return 'AI_PROVIDER_UNAVAILABLE'
  if (TRANSIENT_PATTERN.test(text)) return 'AI_PROVIDER_UNAVAILABLE'
  return AI_CHAT_ERROR_FALLBACK
}

export function keyStatusForError(code: AiChatErrorCode): AiProviderStatus | null {
  return KEY_STATUS_BY_CODE[code] ?? null
}
