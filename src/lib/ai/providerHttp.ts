const ERROR_STATUS: Record<string, number> = {
  UNAUTHORIZED: 401,
  VALIDATION_ERROR: 400,
  AI_KEY_INVALID: 400,
  AI_KEY_CHECK_FAILED: 502,
  AI_PROVIDER_KEY_MISSING: 404,
  AI_MODEL_NOT_ALLOWED: 400,
}

const DEFAULT_ERROR_STATUS = 500

export function aiProviderErrorStatus(error: string): number {
  return ERROR_STATUS[error] ?? DEFAULT_ERROR_STATUS
}
