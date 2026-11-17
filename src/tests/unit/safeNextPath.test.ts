import { describe, expect, it } from 'vitest'
import { DEFAULT_NEXT_PATH, resolveSafeNextPath } from '@/lib/security/safeNextPath'

const ORIGIN = 'https://app.example.com'

describe('resolveSafeNextPath', () => {
  it.each(['//evil.com', '/\\evil.com', 'https://evil.com', '', null, 'dashboard'])(
    'falls back for %s',
    (value) => {
      expect(resolveSafeNextPath(value, ORIGIN)).toBe(DEFAULT_NEXT_PATH)
    }
  )

  it('keeps same-origin paths', () => {
    expect(resolveSafeNextPath('/reset-password', ORIGIN)).toBe('/reset-password')
    expect(resolveSafeNextPath('/dashboard?x=1', ORIGIN)).toBe('/dashboard?x=1')
    expect(resolveSafeNextPath('/a?b=1#c', ORIGIN)).toBe('/a?b=1#c')
  })
})
