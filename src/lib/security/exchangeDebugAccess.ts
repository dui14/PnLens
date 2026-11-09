const DEBUG_ROUTE_PREFIX = '/api/exchange/debug'

const DEFAULT_DEBUG_ORIGIN = {
  binance: 'https://api.binance.com',
  okx: 'https://www.okx.com',
  bybit: 'https://api.bybit.com',
  bitget: 'https://api.bitget.com',
  gateio: 'https://api.gateio.ws',
} as const

const DEBUG_EXCHANGE_HOSTS: Record<DebugExchange, readonly string[]> = {
  binance: ['api.binance.com', 'fapi.binance.com'],
  okx: ['www.okx.com', 'aws.okx.com'],
  bybit: ['api.bybit.com', 'api.bytick.com'],
  bitget: ['api.bitget.com'],
  gateio: ['api.gateio.ws'],
}

export type DebugExchange = keyof typeof DEFAULT_DEBUG_ORIGIN

export type DebugAccessEnv = {
  NODE_ENV?: string
  EXCHANGE_DEBUG_VERIFY_ENABLED?: string
}

export type DebugBaseUrlResult =
  | { ok: true; baseUrl: string }
  | { ok: false }

export function isExchangeDebugPath(pathname: string): boolean {
  return pathname === DEBUG_ROUTE_PREFIX || pathname.startsWith(`${DEBUG_ROUTE_PREFIX}/`)
}

export function isExchangeDebugVerifyEnabled(env: DebugAccessEnv): boolean {
  if (env.EXCHANGE_DEBUG_VERIFY_ENABLED === 'true') return true
  if (env.EXCHANGE_DEBUG_VERIFY_ENABLED === 'false') return false
  return env.NODE_ENV !== 'production'
}

export function resolveDebugBaseUrl(
  exchange: DebugExchange,
  baseUrl: string | undefined
): DebugBaseUrlResult {
  const candidate = baseUrl?.trim()
  if (!candidate) {
    return { ok: true, baseUrl: DEFAULT_DEBUG_ORIGIN[exchange] }
  }

  let parsed: URL
  try {
    parsed = new URL(candidate)
  } catch {
    return { ok: false }
  }

  const portAllowed = parsed.port === '' || parsed.port === '443'
  const pathAllowed = parsed.pathname === '/' || parsed.pathname === ''
  const hostAllowed = DEBUG_EXCHANGE_HOSTS[exchange].includes(parsed.hostname)

  if (
    parsed.protocol !== 'https:' ||
    !hostAllowed ||
    !portAllowed ||
    !pathAllowed ||
    parsed.username !== '' ||
    parsed.password !== '' ||
    parsed.search !== '' ||
    parsed.hash !== ''
  ) {
    return { ok: false }
  }

  return { ok: true, baseUrl: parsed.origin }
}
