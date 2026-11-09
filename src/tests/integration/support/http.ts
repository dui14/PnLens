import { afterEach, beforeEach, vi } from 'vitest'

const realSetTimeout = globalThis.setTimeout.bind(globalThis)

export const credentials = {
  apiKey: 'test-api-key',
  apiSecret: 'test-api-secret',
  passphrase: 'test-passphrase',
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

export function recentSince(): Date {
  return new Date(Date.now() - 1_000)
}

export function installFastSleep(): void {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(globalThis, 'setTimeout').mockImplementation(((
      handler: TimerHandler,
      timeout?: number,
      ...args: unknown[]
    ) => {
      const delay = typeof timeout === 'number' ? timeout : 0
      if (typeof handler === 'function' && delay > 0 && delay < 10_000) {
        handler(...args)
        return 0 as unknown as ReturnType<typeof setTimeout>
      }
      return realSetTimeout(handler, timeout, ...args)
    }) as typeof setTimeout)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })
}

export function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.toString()
  return input.url
}
