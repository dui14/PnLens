export const COOLDOWN_TICK_MS = 1000
export const RETRY_AFTER_HEADER = 'Retry-After'

const MS_PER_SECOND = 1000
const SECONDS_PER_MINUTE = 60
const COUNTDOWN_PAD = 2

export function cooldownAvailableAt(
  referenceIso: string | null | undefined,
  cooldownMs: number,
  now: Date
): string | null {
  if (!referenceIso) return null
  const referenceMs = new Date(referenceIso).getTime()
  if (Number.isNaN(referenceMs)) return null
  const availableMs = referenceMs + cooldownMs
  return availableMs > now.getTime() ? new Date(availableMs).toISOString() : null
}

export function cooldownRetryAt(
  referenceIso: string | null | undefined,
  cooldownMs: number,
  now: Date
): string {
  return (
    cooldownAvailableAt(referenceIso, cooldownMs, now) ??
    new Date(now.getTime() + cooldownMs).toISOString()
  )
}

export function retryAfterSeconds(availableAtIso: string, now: Date): number {
  const remaining = new Date(availableAtIso).getTime() - now.getTime()
  return Math.max(0, Math.ceil(remaining / MS_PER_SECOND))
}

export function retryAfterHeaders(availableAtIso: string, now: Date): Record<string, string> {
  return { [RETRY_AFTER_HEADER]: String(retryAfterSeconds(availableAtIso, now)) }
}

export function remainingCooldownMs(availableAtIso: string | null | undefined, nowMs: number): number {
  if (!availableAtIso) return 0
  const availableMs = new Date(availableAtIso).getTime()
  if (Number.isNaN(availableMs)) return 0
  return Math.max(0, availableMs - nowMs)
}

export function formatCountdown(remainingMs: number): string {
  const totalSeconds = Math.max(0, Math.ceil(remainingMs / MS_PER_SECOND))
  const minutes = Math.floor(totalSeconds / SECONDS_PER_MINUTE)
  const seconds = totalSeconds % SECONDS_PER_MINUTE
  return `${String(minutes).padStart(COUNTDOWN_PAD, '0')}:${String(seconds).padStart(COUNTDOWN_PAD, '0')}`
}

export function latestAvailableAt(
  first: string | null | undefined,
  second: string | null | undefined
): string | null {
  if (!first) return second ?? null
  if (!second) return first
  return new Date(first).getTime() >= new Date(second).getTime() ? first : second
}
