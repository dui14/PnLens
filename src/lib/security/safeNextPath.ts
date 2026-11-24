export const DEFAULT_NEXT_PATH = '/dashboard'

export function resolveSafeNextPath(next: string | null, appOrigin: string): string {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) {
    return DEFAULT_NEXT_PATH
  }
  try {
    const resolved = new URL(next, appOrigin)
    if (resolved.origin !== new URL(appOrigin).origin) {
      return DEFAULT_NEXT_PATH
    }
    return `${resolved.pathname}${resolved.search}${resolved.hash}`
  } catch {
    return DEFAULT_NEXT_PATH
  }
}
