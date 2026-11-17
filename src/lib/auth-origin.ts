export function getClientAppOrigin(): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL
  if (configured) {
    try {
      return new URL(configured).origin
    } catch {}
  }
  return window.location.origin
}
