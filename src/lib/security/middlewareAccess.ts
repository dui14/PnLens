export type MiddlewareAccessDecision =
  | 'continue'
  | 'auth_unavailable'
  | 'unauthorized'
  | 'redirect_login'
  | 'redirect_dashboard'

export type MiddlewareAccessInput = {
  isProtected: boolean
  isAuthRoute: boolean
  isApiRoute: boolean
  userPresent: boolean
  authUnavailable: boolean
}

export function decideMiddlewareAccess(input: MiddlewareAccessInput): MiddlewareAccessDecision {
  if (input.isProtected && !input.userPresent && input.authUnavailable && input.isApiRoute) {
    return 'auth_unavailable'
  }

  if (input.isProtected && !input.userPresent && input.isApiRoute) {
    return 'unauthorized'
  }

  if (input.isProtected && !input.userPresent) {
    return 'redirect_login'
  }

  if (input.isAuthRoute && input.userPresent) {
    return 'redirect_dashboard'
  }

  return 'continue'
}
