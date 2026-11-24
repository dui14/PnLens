import type { SupabaseClient } from '@supabase/supabase-js'
import { SECRET_FORMATS, type ExchangeAccount, type ApiKeyRow, type ExchangeAccountWithStats, type SecretFormat } from '@/lib/types'

function hasMissingColumnError(error: unknown, column: string): boolean {
  if (!error || typeof error !== 'object') return false
  const message = 'message' in error ? String(error.message ?? '') : ''
  return message.includes(column) && message.toLowerCase().includes('column')
}

function secretFormatOf(value: unknown): SecretFormat | null {
  return (SECRET_FORMATS as readonly unknown[]).includes(value) ? (value as SecretFormat) : null
}

function normalizeExchangeAccount(row: Record<string, unknown>, userId: string): ExchangeAccount {
  const syncStatus: ExchangeAccount['sync_status'] =
    row.sync_status === 'pending' ||
    row.sync_status === 'syncing' ||
    row.sync_status === 'synced' ||
    row.sync_status === 'error'
      ? row.sync_status
      : 'pending'
  const syncError = typeof row.sync_error === 'string' ? row.sync_error : null

  return {
    id: String(row.id),
    user_id: typeof row.user_id === 'string' ? row.user_id : userId,
    exchange: row.exchange as ExchangeAccount['exchange'],
    label: typeof row.label === 'string' ? row.label : null,
    is_active: Boolean(row.is_active),
    sync_status: syncStatus,
    sync_error: syncError,
    sync_started_at: typeof row.sync_started_at === 'string' ? row.sync_started_at : null,
    last_synced: typeof row.last_synced === 'string' ? row.last_synced : null,
    created_at: typeof row.created_at === 'string' ? row.created_at : new Date().toISOString(),
  }
}

export async function createExchangeAccount(
  supabase: SupabaseClient,
  userId: string,
  exchange: string,
  label: string | null
): Promise<ExchangeAccount | null> {
  const primary = await supabase
    .from('exchange_accounts')
    .insert({ user_id: userId, exchange, label, sync_status: 'pending' })
    .select()
    .single()

  if (!primary.error && primary.data) {
    return normalizeExchangeAccount(primary.data as unknown as Record<string, unknown>, userId)
  }

  if (!hasMissingColumnError(primary.error, 'sync_status')) {
    return null
  }

  const fallback = await supabase
    .from('exchange_accounts')
    .insert({ user_id: userId, exchange, label })
    .select()
    .single()

  if (fallback.error || !fallback.data) return null
  return normalizeExchangeAccount(fallback.data as unknown as Record<string, unknown>, userId)
}

export async function createApiKey(
  supabase: SupabaseClient,
  exchangeAccountId: string,
  keyEncrypted: string,
  secretEncrypted: string,
  keyIv: string,
  secretIv: string,
  passphraseEncrypted: string | null,
  passphraseIv: string | null,
  proxyEncrypted: string | null,
  proxyIv: string | null,
  secretFormat: SecretFormat
): Promise<boolean> {
  let includePassphrase = true
  let includeProxy = true
  let includeSecretFormat = true

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const payload: Record<string, unknown> = {
      exchange_account_id: exchangeAccountId,
      key_encrypted: keyEncrypted,
      secret_encrypted: secretEncrypted,
      key_iv: keyIv,
      secret_iv: secretIv,
    }

    if (includePassphrase) {
      payload.passphrase_encrypted = passphraseEncrypted
      payload.passphrase_iv = passphraseIv
    }

    if (includeProxy) {
      payload.proxy_encrypted = proxyEncrypted
      payload.proxy_iv = proxyIv
    }

    if (includeSecretFormat) {
      payload.secret_format = secretFormat
    }

    const result = await supabase.from('api_keys').insert(payload)
    if (!result.error) return true

    const missingSecretFormatColumn = hasMissingColumnError(result.error, 'secret_format')

    const missingPassphraseColumn =
      hasMissingColumnError(result.error, 'passphrase_encrypted') ||
      hasMissingColumnError(result.error, 'passphrase_iv')

    const missingProxyColumn =
      hasMissingColumnError(result.error, 'proxy_encrypted') ||
      hasMissingColumnError(result.error, 'proxy_iv')

    if (!missingPassphraseColumn && !missingProxyColumn && !missingSecretFormatColumn) {
      return false
    }

    if (missingSecretFormatColumn) {
      includeSecretFormat = false
    }

    if (missingPassphraseColumn) {
      includePassphrase = false
    }

    if (missingProxyColumn) {
      includeProxy = false
    }
  }

  return false
}

export async function getExchangeAccounts(
  supabase: SupabaseClient,
  userId: string
): Promise<ExchangeAccountWithStats[]> {
  const primary = await supabase
    .from('exchange_accounts')
    .select('id, exchange, label, is_active, sync_status, sync_error, last_synced, created_at, trades(id), api_keys(passphrase_encrypted)')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })

  if (!primary.error && primary.data) {
    return primary.data.map((row) => {
      const record = row as unknown as Record<string, unknown>
      const tradeRows = Array.isArray(record.trades) ? record.trades : []
      const keyRows = (Array.isArray(record.api_keys) ? record.api_keys : []) as Record<string, unknown>[]

      return {
        ...normalizeExchangeAccount(record, userId),
        trade_count: tradeRows.length,
        has_passphrase: keyRows.some((keyRow) => Boolean(keyRow.passphrase_encrypted)),
        secret_format: null,
      }
    }) as ExchangeAccountWithStats[]
  }

  const fallback = await supabase
    .from('exchange_accounts')
    .select('id, user_id, exchange, label, is_active, last_synced, created_at, trades(id)')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })

  if (fallback.error) return []

  return (fallback.data ?? []).map((row) => {
    const tradeRows = Array.isArray(row.trades) ? row.trades : []

    return {
      ...normalizeExchangeAccount(row as unknown as Record<string, unknown>, userId),
      trade_count: tradeRows.length,
      has_passphrase: false,
      secret_format: null,
    }
  }) as ExchangeAccountWithStats[]
}

export type ApiKeyMetadata = {
  secret_format: SecretFormat | null
  has_passphrase: boolean
}

export async function getApiKeyMetadata(
  serviceSupabase: SupabaseClient,
  exchangeAccountIds: string[]
): Promise<Map<string, ApiKeyMetadata>> {
  const metadata = new Map<string, ApiKeyMetadata>()
  if (exchangeAccountIds.length === 0) return metadata

  const withFormat = await serviceSupabase
    .from('api_keys')
    .select('exchange_account_id, passphrase_iv, secret_format')
    .in('exchange_account_id', exchangeAccountIds)

  const result = withFormat.error && hasMissingColumnError(withFormat.error, 'secret_format')
    ? await serviceSupabase
        .from('api_keys')
        .select('exchange_account_id, passphrase_iv')
        .in('exchange_account_id', exchangeAccountIds)
    : withFormat

  if (result.error || !result.data) return metadata

  for (const row of result.data as Record<string, unknown>[]) {
    metadata.set(String(row.exchange_account_id), {
      secret_format: secretFormatOf(row.secret_format),
      has_passphrase: typeof row.passphrase_iv === 'string' && row.passphrase_iv.length > 0,
    })
  }

  return metadata
}

export async function getExchangeAccountById(
  supabase: SupabaseClient,
  accountId: string,
  userId: string
): Promise<ExchangeAccount | null> {
  const { data, error } = await supabase
    .from('exchange_accounts')
    .select('*')
    .eq('id', accountId)
    .eq('user_id', userId)
    .single()

  if (error || !data) return null
  return normalizeExchangeAccount(data as unknown as Record<string, unknown>, userId)
}

export async function getApiKey(
  supabase: SupabaseClient,
  exchangeAccountId: string
): Promise<ApiKeyRow | null> {
  const { data, error } = await supabase
    .from('api_keys')
    .select('*')
    .eq('exchange_account_id', exchangeAccountId)
    .order('created_at', { ascending: false })
    .limit(1)
    .single()

  if (error || !data) return null

  const normalized: ApiKeyRow = {
    id: String(data.id),
    exchange_account_id: String(data.exchange_account_id),
    key_encrypted: String(data.key_encrypted),
    secret_encrypted: String(data.secret_encrypted),
    passphrase_encrypted:
      typeof data.passphrase_encrypted === 'string' ? data.passphrase_encrypted : null,
    proxy_encrypted: null,
    key_iv: String(data.key_iv),
    secret_iv: String(data.secret_iv),
    passphrase_iv: typeof data.passphrase_iv === 'string' ? data.passphrase_iv : null,
    proxy_iv: null,
    key_version: typeof data.key_version === 'number' ? data.key_version : 1,
    created_at: String(data.created_at),
  }

  return normalized
}

export async function updateLastSynced(
  supabase: SupabaseClient,
  accountId: string,
  syncStatus: 'synced' | 'error',
  syncError: string | null
): Promise<void> {
  const primary = await supabase
    .from('exchange_accounts')
    .update({
      last_synced: new Date().toISOString(),
      sync_status: syncStatus,
      sync_error: syncError,
    })
    .eq('id', accountId)

  if (
    primary.error &&
    (hasMissingColumnError(primary.error, 'sync_status') ||
      hasMissingColumnError(primary.error, 'sync_error'))
  ) {
    await supabase
      .from('exchange_accounts')
      .update({ last_synced: new Date().toISOString() })
      .eq('id', accountId)
  }
}

export type ScanClaimResult = 'claimed' | 'not_found' | 'inactive' | 'in_progress' | 'rate_limited'

export async function getExchangeAccountByAccountId(
  supabase: SupabaseClient,
  accountId: string
): Promise<ExchangeAccount | null> {
  const { data, error } = await supabase
    .from('exchange_accounts')
    .select('*')
    .eq('id', accountId)
    .maybeSingle()

  if (error || !data) return null
  return normalizeExchangeAccount(data as unknown as Record<string, unknown>, String(data.user_id ?? ''))
}

export async function claimExchangeScan(
  supabase: SupabaseClient,
  accountId: string,
  userId: string,
  nowIso: string,
  cooldownBeforeIso: string,
  staleBeforeIso: string
): Promise<ScanClaimResult> {
  const existing = await getExchangeAccountById(supabase, accountId, userId)
  if (!existing) return 'not_found'
  if (!existing.is_active) return 'inactive'

  const claimed = await updateScanClaim(supabase, accountId, userId, nowIso, cooldownBeforeIso, staleBeforeIso)
  if (claimed === 'claimed') return 'claimed'
  if (claimed === 'missing_column') {
    const fallback = await supabase
      .from('exchange_accounts')
      .update({ sync_status: 'syncing', sync_error: null })
      .eq('id', accountId)
      .eq('user_id', userId)
      .eq('is_active', true)
      .neq('sync_status', 'syncing')
      .or(`last_synced.is.null,last_synced.lte."${cooldownBeforeIso}"`)
      .select('id')
    if (!fallback.error && (fallback.data?.length ?? 0) > 0) return 'claimed'
  }

  const latest = await getExchangeAccountById(supabase, accountId, userId)
  if (!latest) return 'not_found'
  if (!latest.is_active) return 'inactive'
  if (latest.sync_status === 'syncing') return 'in_progress'
  return 'rate_limited'
}

async function updateScanClaim(
  supabase: SupabaseClient,
  accountId: string,
  userId: string,
  nowIso: string,
  cooldownBeforeIso: string,
  staleBeforeIso: string
): Promise<'claimed' | 'empty' | 'missing_column'> {
  const result = await supabase
    .from('exchange_accounts')
    .update({
      sync_status: 'syncing',
      sync_error: null,
      sync_started_at: nowIso,
    })
    .eq('id', accountId)
    .eq('user_id', userId)
    .eq('is_active', true)
    .or(
      `and(sync_status.neq.syncing,or(last_synced.is.null,last_synced.lte."${cooldownBeforeIso}")),and(sync_status.eq.syncing,sync_started_at.lte."${staleBeforeIso}")`
    )
    .select('id')

  if (result.error && hasMissingColumnError(result.error, 'sync_started_at')) return 'missing_column'
  if (result.error) return 'empty'
  return (result.data?.length ?? 0) > 0 ? 'claimed' : 'empty'
}

export async function updateSyncStatus(
  supabase: SupabaseClient,
  accountId: string,
  syncStatus: 'pending' | 'syncing' | 'synced' | 'error',
  syncError: string | null
): Promise<void> {
  const result = await supabase
    .from('exchange_accounts')
    .update({ sync_status: syncStatus, sync_error: syncError })
    .eq('id', accountId)

  if (
    result.error &&
    (hasMissingColumnError(result.error, 'sync_status') ||
      hasMissingColumnError(result.error, 'sync_error'))
  ) {
    return
  }
}

export async function deleteExchangeAccount(
  supabase: SupabaseClient,
  accountId: string,
  userId: string
): Promise<boolean> {
  const { error } = await supabase
    .from('exchange_accounts')
    .delete()
    .eq('id', accountId)
    .eq('user_id', userId)

  return !error
}

export async function updateExchangeActive(
  supabase: SupabaseClient,
  accountId: string,
  userId: string,
  isActive: boolean
): Promise<boolean> {
  const { error } = await supabase
    .from('exchange_accounts')
    .update({ is_active: isActive })
    .eq('id', accountId)
    .eq('user_id', userId)

  return !error
}

export async function updateApiKeyRecord(
  supabase: SupabaseClient,
  exchangeAccountId: string,
  keyEncrypted: string,
  secretEncrypted: string,
  keyIv: string,
  secretIv: string,
  passphraseEncrypted: string | null,
  passphraseIv: string | null,
  secretFormat: SecretFormat
): Promise<boolean> {
  let includePassphrase = true
  let includeSecretFormat = true

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const payload: Record<string, unknown> = {
      key_encrypted: keyEncrypted,
      secret_encrypted: secretEncrypted,
      key_iv: keyIv,
      secret_iv: secretIv,
    }

    if (includePassphrase) {
      payload.passphrase_encrypted = passphraseEncrypted
      payload.passphrase_iv = passphraseIv
    }

    if (includeSecretFormat) {
      payload.secret_format = secretFormat
    }

    const result = await supabase
      .from('api_keys')
      .update(payload)
      .eq('exchange_account_id', exchangeAccountId)

    if (!result.error) return true

    const missingPassphraseColumn =
      hasMissingColumnError(result.error, 'passphrase_encrypted') ||
      hasMissingColumnError(result.error, 'passphrase_iv')
    const missingSecretFormatColumn = hasMissingColumnError(result.error, 'secret_format')

    if (!missingPassphraseColumn && !missingSecretFormatColumn) return false
    if (missingPassphraseColumn) includePassphrase = false
    if (missingSecretFormatColumn) includeSecretFormat = false
  }

  return false
}

export async function exchangeAccountExists(
  supabase: SupabaseClient,
  userId: string,
  exchange: string
): Promise<boolean> {
  const { count, error } = await supabase
    .from('exchange_accounts')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('exchange', exchange)

  if (error) return false
  return (count ?? 0) > 0
}
