export const VALIDATION_ATTEMPT_LIMIT = 10
export const VALIDATION_ATTEMPT_WINDOW_MS = 60 * 60 * 1000

const attempts = new Map<string, number[]>()

export function consumeValidationAttempt(userId: string, now = Date.now()): boolean {
  const recent = (attempts.get(userId) ?? []).filter((timestamp) => now - timestamp < VALIDATION_ATTEMPT_WINDOW_MS)
  if (recent.length >= VALIDATION_ATTEMPT_LIMIT) {
    attempts.set(userId, recent)
    return false
  }
  recent.push(now)
  attempts.set(userId, recent)
  return true
}
