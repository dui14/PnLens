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

const GATE_FLAG_NAMES = ['spot.write', 'futures.write', 'withdraw.write', 'transfer.write', 'read_only'] as const

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

  const warnings: string[] = []
  if (record?.enableFutures === true) warnings.push('FUTURES_PERMISSION_PRESENT')
  if (record?.ipRestrict === false) warnings.push('IP_RESTRICT_DISABLED')

  if (record?.enableWithdrawals === true) {
    return probeFailure('WITHDRAW_PERMISSION_DETECTED', ['enableWithdrawals'])
  }
  if (record?.enableInternalTransfer === true || record?.permitsUniversalTransfer === true) {
    return probeFailure('TRANSFER_PERMISSION_DETECTED', ['transfer'])
  }
  if (record?.enableSpotAndMarginTrading === true) {
    return probeFailure('TRADE_PERMISSION_DETECTED', ['enableSpotAndMarginTrading'])
  }
  if (record?.enableReading === false) return probeFailure('INVALID_KEY', ['enableReading'])

  const readOnly =
    record?.enableReading === true &&
    record.enableSpotAndMarginTrading === false &&
    record.enableWithdrawals === false &&
    record.enableInternalTransfer === false &&
    record.permitsUniversalTransfer === false

  if (!readOnly) return probeOk([], ['PERMISSIONS_UNVERIFIED', ...warnings])
  return probeOk(['enableReading'], warnings)
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

  const perm = row.perm.trim()
  const permissions = perm
    .split(',')
    .map((token) => token.trim())
    .filter((token) => token.length > 0)

  if (permissions.includes('withdraw')) return probeFailure('WITHDRAW_PERMISSION_DETECTED', permissions)
  if (permissions.includes('trade')) return probeFailure('TRADE_PERMISSION_DETECTED', permissions)
  if (perm === 'read_only') return probeOk(['read_only'], [])
  return probeOk(permissions, ['PERMISSIONS_UNVERIFIED'])
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
  if (!result || readOnly !== true) return probeOk([], ['PERMISSIONS_UNVERIFIED'])

  const warnings: string[] = []
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
  if (!data || !authorities) return probeOk([], ['PERMISSIONS_UNVERIFIED'])

  const normalized = authorities.map((token) => token.toLowerCase())
  if (normalized.includes('withdraw')) return probeFailure('WITHDRAW_PERMISSION_DETECTED', authorities)
  if (normalized.includes('trade')) return probeFailure('TRADE_PERMISSION_DETECTED', authorities)
  if (normalized.includes('transfer')) return probeFailure('TRANSFER_PERMISSION_DETECTED', authorities)
  if (!keyStatus) return probeOk(authorities, ['PERMISSIONS_UNVERIFIED'])
  if (keyStatus !== 'normal') return probeFailure('INVALID_KEY', authorities)

  const exactReadOnly = normalized.length === 1 && normalized[0] === 'readonly'
  const warnings = exactReadOnly ? [] : ['PERMISSIONS_UNVERIFIED']
  if (!Array.isArray(data.ipList) || data.ipList.length === 0) warnings.push('IP_RESTRICT_DISABLED')
  return probeOk(exactReadOnly ? ['readonly'] : authorities, warnings)
}

function topLevelFlag(record: Record<string, unknown> | null, name: string): boolean | null {
  if (!record || typeof record[name] !== 'boolean') return null
  return record[name]
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

  const readOnly = topLevelFlag(record, 'read_only')
  const spotWrite = topLevelFlag(record, 'spot.write')
  const futuresWrite = topLevelFlag(record, 'futures.write')
  const withdrawWrite = topLevelFlag(record, 'withdraw.write')
  const transferWrite = topLevelFlag(record, 'transfer.write')
  const permissions = (GATE_FLAG_NAMES as readonly string[]).filter((name) => topLevelFlag(record, name) === true)

  if (withdrawWrite === true) return probeFailure('WITHDRAW_PERMISSION_DETECTED', permissions)
  if (spotWrite === true || futuresWrite === true) return probeFailure('TRADE_PERMISSION_DETECTED', permissions)
  if (transferWrite === true) return probeFailure('TRANSFER_PERMISSION_DETECTED', permissions)
  if (readOnly === false) return probeFailure('INVALID_KEY', permissions)

  const confirmed =
    readOnly === true &&
    spotWrite === false &&
    futuresWrite === false &&
    withdrawWrite === false &&
    transferWrite === false

  if (!confirmed) return probeOk(permissions, ['PERMISSIONS_UNVERIFIED'])
  return probeOk(permissions, [])
}
