export const CREDENTIAL_VALIDATION_CODES = [
  'OK',
  'INVALID_KEY',
  'INVALID_SECRET_OR_PASSPHRASE',
  'IP_NOT_WHITELISTED',
  'TRADE_PERMISSION_DETECTED',
  'WITHDRAW_PERMISSION_DETECTED',
  'TRANSFER_PERMISSION_DETECTED',
  'GEO_BLOCKED',
  'RATE_LIMITED',
  'EXCHANGE_UNREACHABLE',
  'EXCHANGE_TIME_DRIFT',
  'UNKNOWN',
] as const

export type CredentialValidationCode = (typeof CREDENTIAL_VALIDATION_CODES)[number]

export type CredentialProbeResult = {
  ok: boolean
  code: CredentialValidationCode
  permissions: string[]
  warnings: string[]
}

const WRITE_FLAGS = ['spot.write', 'futures.write', 'withdraw.write', 'transfer.write'] as const
const GATE_FLAG_NAMES = [...WRITE_FLAGS, 'read_only'] as const

export function probeOk(permissions: string[], warnings: string[] = []): CredentialProbeResult {
  return { ok: true, code: 'OK', permissions, warnings }
}

export function probeFailure(
  code: Exclude<CredentialValidationCode, 'OK'>,
  permissions: string[] = []
): CredentialProbeResult {
  return { ok: false, code, permissions, warnings: [] }
}

export async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    return null
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function textOf(record: Record<string, unknown> | null): string {
  if (!record) return ''
  return [record.msg, record.message, record.retMsg, record.label]
    .filter((part): part is string => typeof part === 'string')
    .join(' ')
    .toLowerCase()
}

function transportCode(status: number): Exclude<CredentialValidationCode, 'OK'> | null {
  if (status === 429 || status === 418) return 'RATE_LIMITED'
  if (status === 451) return 'GEO_BLOCKED'
  if (status >= 500) return 'EXCHANGE_UNREACHABLE'
  return null
}

function geoFromText(record: Record<string, unknown> | null): boolean {
  const text = textOf(record)
  return text.includes('restricted location')
}

function ipFromText(record: Record<string, unknown> | null): boolean {
  const text = textOf(record)
  return (
    text.includes('ip whitelist') ||
    text.includes('not included in the whitelist') ||
    text.includes('ip address is not') ||
    text.includes('unmatched ip')
  )
}

function codeString(record: Record<string, unknown> | null): string {
  if (!record) return ''
  if (typeof record.code === 'string' || typeof record.code === 'number') return String(record.code)
  return ''
}

export function interpretBinanceRestrictions(status: number, body: unknown): CredentialProbeResult {
  const transport = transportCode(status)
  if (transport) return probeFailure(transport)

  const record = asRecord(body)
  if (geoFromText(record)) return probeFailure('GEO_BLOCKED')
  if (ipFromText(record)) return probeFailure('IP_NOT_WHITELISTED')

  const code = typeof record?.code === 'number' ? record.code : null
  if (code === -1021) return probeFailure('EXCHANGE_TIME_DRIFT')
  if (code === -1022) return probeFailure('INVALID_SECRET_OR_PASSPHRASE')

  if (status < 200 || status >= 300) {
    if (status === 401 || status === 400 || code === -2014 || code === -2015 || code === -2008) {
      return probeFailure('INVALID_KEY')
    }
    return probeFailure('UNKNOWN')
  }

  const fields = [
    'enableReading',
    'enableSpotAndMarginTrading',
    'enableWithdrawals',
    'enableInternalTransfer',
    'permitsUniversalTransfer',
  ]
  const present = fields.filter((field) => typeof record?.[field] === 'boolean')
  if (!record || present.length === 0) return probeOk([], ['PERMISSIONS_UNVERIFIED'])

  const permissions = present.filter((field) => record[field] === true)
  if (record.enableWithdrawals === true) {
    return probeFailure('WITHDRAW_PERMISSION_DETECTED', permissions)
  }
  if (record.enableInternalTransfer === true || record.permitsUniversalTransfer === true) {
    return probeFailure('TRANSFER_PERMISSION_DETECTED', permissions)
  }
  if (record.enableSpotAndMarginTrading === true) {
    return probeFailure('TRADE_PERMISSION_DETECTED', permissions)
  }
  if (record.enableReading === false) return probeFailure('INVALID_KEY', permissions)

  const warnings: string[] = []
  if (record.ipRestrict === false) warnings.push('IP_RESTRICT_DISABLED')
  if (present.length < fields.length) warnings.push('PERMISSIONS_UNVERIFIED')
  return probeOk(permissions, warnings)
}

export function interpretOkxConfig(status: number, body: unknown): CredentialProbeResult {
  const transport = transportCode(status)
  if (transport) return probeFailure(transport)

  const record = asRecord(body)
  if (geoFromText(record)) return probeFailure('GEO_BLOCKED')
  if (ipFromText(record)) return probeFailure('IP_NOT_WHITELISTED')

  const code = codeString(record)
  if (code === '50102') return probeFailure('EXCHANGE_TIME_DRIFT')
  if (code === '50011') return probeFailure('RATE_LIMITED')
  if (code === '50113' || code === '50105' || code === '50106') {
    return probeFailure('INVALID_SECRET_OR_PASSPHRASE')
  }
  if (code === '50111' || code === '50103') return probeFailure('INVALID_KEY')
  if (code === '50110') return probeFailure('IP_NOT_WHITELISTED')

  if (status < 200 || status >= 300) {
    if (status === 401 || status === 400) return probeFailure('INVALID_KEY')
    return probeFailure('UNKNOWN')
  }

  if (code && code !== '0') return probeFailure('UNKNOWN')

  const row = Array.isArray(record?.data) ? asRecord(record.data[0]) : null
  if (!row || typeof row.perm !== 'string') return probeOk([], ['PERMISSIONS_UNVERIFIED'])

  const permissions = row.perm
    .split(',')
    .map((token) => token.trim())
    .filter((token) => token.length > 0)

  if (permissions.includes('withdraw')) return probeFailure('WITHDRAW_PERMISSION_DETECTED', permissions)
  if (permissions.includes('trade')) return probeFailure('TRADE_PERMISSION_DETECTED', permissions)
  if (!permissions.includes('read_only')) return probeFailure('INVALID_KEY', permissions)
  return probeOk(permissions, [])
}

function collectStrings(value: unknown, out: string[]): void {
  if (typeof value === 'string') {
    out.push(value)
    return
  }
  if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, out)
    return
  }
  const record = asRecord(value)
  if (!record) return
  for (const child of Object.values(record)) collectStrings(child, out)
}

function readOnlyFlag(value: unknown): boolean | null {
  if (value === 1 || value === '1') return true
  if (value === 0 || value === '0') return false
  return null
}

export function interpretBybitQueryApi(status: number, body: unknown): CredentialProbeResult {
  const transport = transportCode(status)
  if (transport) return probeFailure(transport)

  const record = asRecord(body)
  if (geoFromText(record)) return probeFailure('GEO_BLOCKED')
  if (ipFromText(record)) return probeFailure('IP_NOT_WHITELISTED')

  const retCode = typeof record?.retCode === 'number' ? record.retCode : null
  if (retCode === 10002) return probeFailure('EXCHANGE_TIME_DRIFT')
  if (retCode === 10006) return probeFailure('RATE_LIMITED')
  if (retCode === 10004) return probeFailure('INVALID_SECRET_OR_PASSPHRASE')
  if (retCode === 10003) return probeFailure('INVALID_KEY')
  if (retCode === 10010) return probeFailure('IP_NOT_WHITELISTED')

  if (status < 200 || status >= 300) {
    if (status === 401 || status === 400) return probeFailure('INVALID_KEY')
    return probeFailure('UNKNOWN')
  }

  if (retCode !== 0) return probeFailure('UNKNOWN')

  const result = asRecord(record?.result)
  const readOnly = readOnlyFlag(result?.readOnly)
  const permissionStrings: string[] = []
  collectStrings(result?.permissions, permissionStrings)

  if (permissionStrings.includes('Withdraw')) {
    return probeFailure('WITHDRAW_PERMISSION_DETECTED', permissionStrings)
  }
  if (readOnly === false) return probeFailure('TRADE_PERMISSION_DETECTED', ['readOnly'])
  if (!result || readOnly === null) return probeOk([], ['PERMISSIONS_UNVERIFIED'])

  const warnings: string[] = []
  if (result.permissions !== undefined && result.permissions !== null) {
    warnings.push('PERMISSIONS_UNVERIFIED')
  }
  const ips = result.ips
  const ipsMissing = ips === undefined || ips === null || ips === '' || (Array.isArray(ips) && ips.length === 0)
  if (ipsMissing) warnings.push('IP_WHITELIST_MISSING')
  return probeOk(readOnly ? ['readOnly'] : [], warnings)
}

export function interpretBitgetApiKeyInfo(status: number, body: unknown): CredentialProbeResult {
  const transport = transportCode(status)
  if (transport) return probeFailure(transport)

  const record = asRecord(body)
  if (geoFromText(record)) return probeFailure('GEO_BLOCKED')
  if (ipFromText(record)) return probeFailure('IP_NOT_WHITELISTED')

  const code = codeString(record)
  if (code === '40005') return probeFailure('EXCHANGE_TIME_DRIFT')
  if (code === '40014') return probeFailure('RATE_LIMITED')
  if (code === '40002' || code === '40003') return probeFailure('INVALID_SECRET_OR_PASSPHRASE')
  if (code === '40001') return probeFailure('INVALID_KEY')

  if (status < 200 || status >= 300) {
    if (status === 401 || status === 400) return probeFailure('INVALID_KEY')
    return probeFailure('UNKNOWN')
  }

  if (code && code !== '00000') return probeFailure('UNKNOWN')

  const data = asRecord(record?.data)
  const authorities = Array.isArray(data?.authorities)
    ? data.authorities.filter((token): token is string => typeof token === 'string')
    : null
  const keyStatus = typeof data?.status === 'string' ? data.status : null
  if (!data || !authorities || !keyStatus) return probeOk([], ['PERMISSIONS_UNVERIFIED'])
  if (keyStatus !== 'normal') return probeFailure('INVALID_KEY', authorities)

  const normalized = authorities.map((token) => token.toLowerCase())
  if (!normalized.includes('readonly')) return probeFailure('INVALID_KEY', authorities)
  if (normalized.includes('withdraw')) return probeFailure('WITHDRAW_PERMISSION_DETECTED', authorities)
  if (normalized.includes('trade')) return probeFailure('TRADE_PERMISSION_DETECTED', authorities)
  if (normalized.includes('transfer')) return probeFailure('TRANSFER_PERMISSION_DETECTED', authorities)

  const warnings = normalized.some((token) => token !== 'readonly') ? ['PERMISSIONS_UNVERIFIED'] : []
  if (!Array.isArray(data.ipList) || data.ipList.length === 0) warnings.push('IP_RESTRICT_DISABLED')
  return probeOk(authorities, warnings)
}

function collectGateFlags(value: unknown, found: Map<string, boolean>): void {
  if (Array.isArray(value)) {
    for (const item of value) collectGateFlags(item, found)
    return
  }
  const record = asRecord(value)
  if (!record) return
  for (const [key, child] of Object.entries(record)) {
    if ((GATE_FLAG_NAMES as readonly string[]).includes(key) && typeof child === 'boolean') {
      found.set(key, child)
      continue
    }
    if (child && typeof child === 'object') collectGateFlags(child, found)
  }
}

export function interpretGateAccountDetail(status: number, body: unknown): CredentialProbeResult {
  const transport = transportCode(status)
  if (transport) return probeFailure(transport)

  const record = asRecord(body)
  if (geoFromText(record)) return probeFailure('GEO_BLOCKED')
  if (ipFromText(record)) return probeFailure('IP_NOT_WHITELISTED')

  const label = typeof record?.label === 'string' ? record.label : ''
  if (label === 'INVALID_SIGNATURE') return probeFailure('INVALID_SECRET_OR_PASSPHRASE')
  if (label === 'INVALID_KEY') return probeFailure('INVALID_KEY')

  if (status < 200 || status >= 300) {
    if (status === 401 || status === 400) return probeFailure('INVALID_KEY')
    return probeFailure('UNKNOWN')
  }

  const flags = new Map<string, boolean>()
  collectGateFlags(body, flags)
  const permissions = [...flags.entries()].filter(([, enabled]) => enabled).map(([name]) => name)

  if (flags.get('withdraw.write') === true) return probeFailure('WITHDRAW_PERMISSION_DETECTED', permissions)
  if (flags.get('spot.write') === true || flags.get('futures.write') === true) {
    return probeFailure('TRADE_PERMISSION_DETECTED', permissions)
  }
  if (flags.get('transfer.write') === true) return probeFailure('TRANSFER_PERMISSION_DETECTED', permissions)
  if (flags.get('read_only') === false) return probeFailure('INVALID_KEY', permissions)

  const writePresent = WRITE_FLAGS.some((name) => flags.has(name))
  if (!writePresent || !flags.has('read_only')) return probeOk(permissions, ['PERMISSIONS_UNVERIFIED'])
  return probeOk(permissions, [])
}
