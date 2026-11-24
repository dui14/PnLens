import { describe, expect, it } from 'vitest'
import { classifyAiError, keyStatusForError } from '@/lib/ai/chatErrors'

describe('classifyAiError', () => {
  it.each([
    ['AI_REQUEST_FAILED:401:bad key', 'AI_KEY_INVALID'],
    ['AI_REQUEST_FAILED:401:token expired', 'AI_KEY_EXPIRED'],
    ['AI_REQUEST_FAILED:403:forbidden', 'AI_KEY_EXPIRED'],
    ['AI_REQUEST_FAILED:402:payment', 'AI_INSUFFICIENT_CREDITS'],
    ['AI_REQUEST_FAILED:404:no such model', 'AI_MODEL_NOT_FOUND'],
    ['AI_REQUEST_FAILED:429:slow down', 'AI_RATE_LIMITED'],
    ['AI_REQUEST_FAILED:429:insufficient_quota', 'AI_INSUFFICIENT_CREDITS'],
    ['AI_REQUEST_FAILED:503:overloaded', 'AI_PROVIDER_UNAVAILABLE'],
    ['AI_REQUEST_FAILED:400:weird', 'AI_UNKNOWN_ERROR'],
    ['AI_REQUEST_FAILED:abc', 'AI_UNKNOWN_ERROR'],
    ['AGENT_LOOP_TIMEOUT', 'AI_PROVIDER_UNAVAILABLE'],
    ['AI_EMPTY_RESPONSE', 'AI_UNKNOWN_ERROR'],
    ['UNKNOWN_TOOL:x', 'AI_UNKNOWN_ERROR'],
    ['AI_PROVIDER_KEY_MISSING', 'AI_PROVIDER_KEY_MISSING'],
    ['AI_MODEL_NOT_ALLOWED', 'AI_MODEL_NOT_ALLOWED'],
    ['INTERNAL_ERROR', 'AI_UNKNOWN_ERROR'],
  ])('maps %s to %s', (raw, expected) => {
    expect(classifyAiError(raw)).toBe(expected)
  })

  it('treats network failures as provider unavailable', () => {
    expect(classifyAiError(new TypeError('fetch failed'))).toBe('AI_PROVIDER_UNAVAILABLE')
  })

  it('falls back for unknown input', () => {
    expect(classifyAiError(undefined)).toBe('AI_UNKNOWN_ERROR')
  })
})

describe('keyStatusForError', () => {
  it('returns a status only for key related codes', () => {
    expect(keyStatusForError('AI_KEY_INVALID')).toBe('invalid')
    expect(keyStatusForError('AI_KEY_EXPIRED')).toBe('expired')
    expect(keyStatusForError('AI_RATE_LIMITED')).toBe('rate_limited')
    expect(keyStatusForError('AI_INSUFFICIENT_CREDITS')).toBe('insufficient_credits')
    expect(keyStatusForError('AI_PROVIDER_UNAVAILABLE')).toBeNull()
    expect(keyStatusForError('AI_MODEL_NOT_FOUND')).toBeNull()
  })
})
