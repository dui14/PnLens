import { describe, expect, it } from 'vitest'
import {
  cooldownAvailableAt,
  cooldownRetryAt,
  formatCountdown,
  latestAvailableAt,
  remainingCooldownMs,
  retryAfterHeaders,
  retryAfterSeconds,
  RETRY_AFTER_HEADER,
} from '@/lib/cooldown/cooldown'

const NOW = new Date('2026-11-15T10:00:00.000Z')
const COOLDOWN_MS = 15 * 60 * 1000

describe('cooldownAvailableAt', () => {
  it('returns reference plus cooldown while in the future', () => {
    const reference = new Date(NOW.getTime() - 60_000).toISOString()
    expect(cooldownAvailableAt(reference, COOLDOWN_MS, NOW)).toBe(
      new Date(NOW.getTime() - 60_000 + COOLDOWN_MS).toISOString()
    )
  })

  it('returns null when elapsed, missing or invalid', () => {
    expect(cooldownAvailableAt(new Date(NOW.getTime() - COOLDOWN_MS).toISOString(), COOLDOWN_MS, NOW)).toBeNull()
    expect(cooldownAvailableAt(null, COOLDOWN_MS, NOW)).toBeNull()
    expect(cooldownAvailableAt('not-a-date', COOLDOWN_MS, NOW)).toBeNull()
  })
})

describe('cooldownRetryAt', () => {
  it('falls back to now plus cooldown', () => {
    expect(cooldownRetryAt(null, COOLDOWN_MS, NOW)).toBe(new Date(NOW.getTime() + COOLDOWN_MS).toISOString())
  })
})

describe('retry after', () => {
  it('rounds seconds up and never goes negative', () => {
    expect(retryAfterSeconds(new Date(NOW.getTime() + 1500).toISOString(), NOW)).toBe(2)
    expect(retryAfterSeconds(new Date(NOW.getTime() - 5000).toISOString(), NOW)).toBe(0)
  })

  it('builds the header', () => {
    expect(retryAfterHeaders(new Date(NOW.getTime() + 90_000).toISOString(), NOW)).toEqual({
      [RETRY_AFTER_HEADER]: '90',
    })
  })
})

describe('remainingCooldownMs', () => {
  it('clamps at zero and handles empty values', () => {
    const at = new Date(NOW.getTime() + 5000).toISOString()
    expect(remainingCooldownMs(at, NOW.getTime())).toBe(5000)
    expect(remainingCooldownMs(at, NOW.getTime() + 9000)).toBe(0)
    expect(remainingCooldownMs(null, NOW.getTime())).toBe(0)
    expect(remainingCooldownMs('bad', NOW.getTime())).toBe(0)
  })
})

describe('formatCountdown', () => {
  it('formats mm:ss', () => {
    expect(formatCountdown(0)).toBe('00:00')
    expect(formatCountdown(999)).toBe('00:01')
    expect(formatCountdown(65_000)).toBe('01:05')
    expect(formatCountdown(COOLDOWN_MS)).toBe('15:00')
    expect(formatCountdown(-100)).toBe('00:00')
  })
})

describe('latestAvailableAt', () => {
  it('picks the later value', () => {
    const early = '2026-11-15T10:00:00.000Z'
    const late = '2026-11-15T10:05:00.000Z'
    expect(latestAvailableAt(early, late)).toBe(late)
    expect(latestAvailableAt(late, early)).toBe(late)
    expect(latestAvailableAt(null, early)).toBe(early)
    expect(latestAvailableAt(late, undefined)).toBe(late)
    expect(latestAvailableAt(null, null)).toBeNull()
  })
})
