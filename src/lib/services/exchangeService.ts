import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  ExchangeAccount,
  ExchangeAccountWithStats,
  SyncResult,
  Result,
  ExchangeCredentials,
  ExchangeBalanceResult,
  ExchangePositionsResult,
} from '@/lib/types'
import {
  createExchangeAccount,
  createApiKey,
  getExchangeAccounts,
  getApiKeyMetadata,
  getExchangeAccountById,
  getApiKey,
  deleteExchangeAccount,
  exchangeAccountExists,
  updateLastSynced,
  updateExchangeActive,
  updateApiKeyRecord,
  updateSyncStatus,
} from '@/lib/db/exchangeDb'
import { deleteExchangeTrackingData, upsertTrades } from '@/lib/db/tradesDb'
import { encrypt, decrypt } from '@/lib/adapters/encryption'
import { isAsymmetricVenue, prepareVenuePrivateKey, type SecretFormat } from '@/lib/adapters/pemPrivateKey'
import { createExchangeAdapter, type ExchangeAdapter } from '@/lib/adapters/exchangeFactory'
import type { CredentialProbeResult } from '@/lib/adapters/credentialValidation'
import { cooldownAvailableAt } from '@/lib/cooldown/cooldown'
import { SCAN_COOLDOWN_MS, SCAN_LOOKBACK_MS, SCAN_STALE_AFTER_MS } from '@/lib/scan/scanLimits'

export { SCAN_COOLDOWN_MS, SCAN_STALE_AFTER_MS }

export const SCAN_ROW_SKIP_CODE = 'ROWS_SKIPPED'

const STORED_WARNINGS = [
  'PERMISSIONS_UNVERIFIED',
  'IP_RESTRICT_DISABLED',
  'IP_WHITELIST_MISSING',
  'FUTURES_PERMISSION_PRESENT',
] as const

function getSyncLookbackDate(): Date {
  return new Date(Date.now() - SCAN_LOOKBACK_MS)
}

function mapProbeErrorForSync(code: string): string {
  if (code === 'GEO_BLOCKED') return 'EXCHANGE_REGION_BLOCKED'
  if (code === 'EXCHANGE_TIME_DRIFT') return 'EXCHANGE_TIME_DRIFT'
  if (code === 'EXCHANGE_UNREACHABLE' || code === 'RATE_LIMITED' || code === 'UNKNOWN') {
    return 'EXCHANGE_UNREACHABLE'
  }
  if (
    code === 'TRADE_PERMISSION_DETECTED' ||
    code === 'WITHDRAW_PERMISSION_DETECTED' ||
    code === 'TRANSFER_PERMISSION_DETECTED'
  ) {
    return 'INVALID_API_KEY'
  }
  return 'INVALID_API_KEY'
}

type PreparedSecret = { stored: string; format: SecretFormat }

function prepareSecret(exchange: string, apiSecret: string): Result<PreparedSecret> {
  if (!isAsymmetricVenue(exchange)) {
    if (!apiSecret.trim()) return { success: false, error: 'INVALID_SECRET_OR_PASSPHRASE' }
    return { success: true, data: { stored: apiSecret, format: 'hmac' } }
  }
  try {
    const prepared = prepareVenuePrivateKey(exchange, apiSecret)
    return { success: true, data: { stored: prepared.stored, format: prepared.algorithm } }
  } catch (error) {
    const unsupported = error instanceof Error && error.message === 'UNSUPPORTED_SIGNING_KEY'
    return { success: false, error: unsupported ? 'PRIVATE_KEY_ALGORITHM_UNSUPPORTED' : 'PRIVATE_KEY_INVALID' }
  }
}

function storedWarnings(probe: CredentialProbeResult): string[] {
  return probe.warnings.filter((warning) =>
    (STORED_WARNINGS as readonly string[]).includes(warning)
  )
}

async function validateCredentialsForAdapter(
  adapter: ExchangeAdapter,
  credentials: ExchangeCredentials
): Promise<Result<CredentialProbeResult, string>> {
  try {
    const probe = await adapter.validateCredentials(credentials)
    if (!probe.ok) {
      console.error('[exchangeService] credential validation failed:', probe.code)
      return { success: false, error: probe.code }
    }
    return { success: true, data: probe }
  } catch {
    console.error('[exchangeService] credential validation failed:', 'EXCHANGE_UNREACHABLE')
    return { success: false, error: 'EXCHANGE_UNREACHABLE' }
  }
}

export async function connectExchange(
  supabase: SupabaseClient,
  userId: string,
  exchange: string,
  apiKey: string,
  apiSecret: string,
  passphrase?: string,
  label?: string,
  proxy?: string
): Promise<Result<{ account: ExchangeAccount; warnings: string[] }>> {
  void proxy
  const secret = prepareSecret(exchange, apiSecret)
  if (!secret.success) {
    return { success: false, error: secret.error }
  }

  if ((exchange === 'okx' || exchange === 'bitget') && !passphrase) {
    return { success: false, error: 'PASSPHRASE_REQUIRED' }
  }

  const exists = await exchangeAccountExists(supabase, userId, exchange)
  if (exists) {
    return { success: false, error: 'CONFLICT' }
  }

  let adapter
  try {
    adapter = await createExchangeAdapter(exchange)
  } catch {
    return { success: false, error: 'UNSUPPORTED_EXCHANGE' }
  }

  const credentials: ExchangeCredentials = {
    apiKey,
    apiSecret: secret.data.stored,
    passphrase,
  }

  const validation = await validateCredentialsForAdapter(adapter, credentials)
  if (!validation.success) {
    return { success: false, error: validation.error }
  }

  const encryptedKey = encrypt(apiKey)
  const encryptedSecret = encrypt(secret.data.stored)
  const encryptedPassphrase = passphrase ? encrypt(passphrase) : null

  const account = await createExchangeAccount(supabase, userId, exchange, label ?? null)
  if (!account) {
    return { success: false, error: 'INTERNAL_ERROR' }
  }

  const serviceSupabase = (await import('@/lib/db/supabase-server')).createSupabaseServiceClient()

  try {
    const keyCreated = await createApiKey(
      serviceSupabase,
      account.id,
      encryptedKey.encrypted,
      encryptedSecret.encrypted,
      encryptedKey.iv,
      encryptedSecret.iv,
      encryptedPassphrase?.encrypted ?? null,
      encryptedPassphrase?.iv ?? null,
      null,
      null,
      secret.data.format
    )
    if (!keyCreated) {
      await removeOrphanAccount(supabase, account.id, userId)
      return { success: false, error: 'INTERNAL_ERROR' }
    }
  } catch {
    await removeOrphanAccount(supabase, account.id, userId)
    return { success: false, error: 'INTERNAL_ERROR' }
  }

  return {
    success: true,
    data: {
      account,
      warnings: storedWarnings(validation.data),
    },
  }
}

export async function listExchangeAccounts(
  supabase: SupabaseClient,
  userId: string
): Promise<Result<ExchangeAccountWithStats[]>> {
  const listedAt = new Date()
  const accounts = (await getExchangeAccounts(supabase, userId)).map((account) => ({
    ...account,
    syncAvailableAt: cooldownAvailableAt(account.last_synced, SCAN_COOLDOWN_MS, listedAt),
  }))
  if (accounts.length === 0) return { success: true, data: accounts }

  const serviceSupabase = (await import('@/lib/db/supabase-server')).createSupabaseServiceClient()
  const metadata = await getApiKeyMetadata(serviceSupabase, accounts.map((account) => account.id))

  return {
    success: true,
    data: accounts.map((account) => {
      const keyMetadata = metadata.get(account.id)
      if (!keyMetadata) return account
      return {
        ...account,
        has_passphrase: account.has_passphrase || keyMetadata.has_passphrase,
        secret_format: keyMetadata.secret_format,
      }
    }),
  }
}

export async function syncExchangeAccount(
  supabase: SupabaseClient,
  userId: string,
  exchangeAccountId: string
): Promise<Result<SyncResult>> {
  const account = await getExchangeAccountById(supabase, exchangeAccountId, userId)
  if (!account) {
    return { success: false, error: 'NOT_FOUND' }
  }

  if (!account.is_active) {
    return { success: false, error: 'ACCOUNT_INACTIVE' }
  }

  await updateSyncStatus(supabase, exchangeAccountId, 'syncing', null)

  const serviceSupabase = (await import('@/lib/db/supabase-server')).createSupabaseServiceClient()
  const loaded = await loadStoredCredentials(serviceSupabase, exchangeAccountId)
  if (!loaded.success) {
    await updateSyncStatus(supabase, exchangeAccountId, 'error', loaded.error)
    return { success: false, error: loaded.error }
  }
  const credentials = loaded.data

  const adapter = await createExchangeAdapter(account.exchange)
  const validation = await validateCredentialsForAdapter(adapter, credentials)
  if (!validation.success) {
    const syncError = mapProbeErrorForSync(validation.error)
    await updateSyncStatus(supabase, exchangeAccountId, 'error', syncError)
    return { success: false, error: syncError }
  }

  const since = getSyncLookbackDate()

  let trades
  try {
    trades = await adapter.fetchTrades(credentials, since)
  } catch (err) {
    console.error('[exchangeService] fetchTrades failed:', err)
    await updateSyncStatus(supabase, exchangeAccountId, 'error', 'EXCHANGE_ERROR')
    return { success: false, error: 'EXCHANGE_ERROR' }
  }

  let newTrades = 0
  try {
    newTrades = await upsertTrades(serviceSupabase, exchangeAccountId, userId, trades)
  } catch (err) {
    console.error('[exchangeService] upsertTrades failed:', err)
    await updateSyncStatus(supabase, exchangeAccountId, 'error', 'INTERNAL_ERROR')
    return { success: false, error: 'INTERNAL_ERROR' }
  }

  const lastSynced = new Date().toISOString()

  await updateLastSynced(supabase, exchangeAccountId, 'synced', null)

  return {
    success: true,
    data: {
      synced_trades: trades.length,
      new_trades: newTrades,
      last_synced: lastSynced,
    },
  }
}

export async function removeExchangeAccount(
  supabase: SupabaseClient,
  userId: string,
  accountId: string
): Promise<Result<{ deleted: boolean }>> {
  const account = await getExchangeAccountById(supabase, accountId, userId)
  if (!account) {
    return { success: false, error: 'NOT_FOUND' }
  }

  const serviceSupabase = (await import('@/lib/db/supabase-server')).createSupabaseServiceClient()
  const trackingDeleted = await deleteExchangeTrackingData(supabase, serviceSupabase, userId, accountId)
  if (!trackingDeleted) {
    return { success: false, error: 'INTERNAL_ERROR' }
  }

  const deleted = await deleteExchangeAccount(supabase, accountId, userId)
  if (!deleted) {
    return { success: false, error: 'INTERNAL_ERROR' }
  }

  return { success: true, data: { deleted: true } }
}

export async function toggleExchangeActive(
  supabase: SupabaseClient,
  userId: string,
  accountId: string,
  isActive: boolean
): Promise<Result<ExchangeAccount>> {
  const account = await getExchangeAccountById(supabase, accountId, userId)
  if (!account) {
    return { success: false, error: 'NOT_FOUND' }
  }

  const updated = await updateExchangeActive(supabase, accountId, userId, isActive)
  if (!updated) {
    return { success: false, error: 'INTERNAL_ERROR' }
  }

  if (!isActive) {
    const serviceSupabase = (await import('@/lib/db/supabase-server')).createSupabaseServiceClient()
    const deleted = await deleteExchangeTrackingData(supabase, serviceSupabase, userId, accountId)
    if (!deleted) {
      await updateExchangeActive(supabase, accountId, userId, true)
      return { success: false, error: 'INTERNAL_ERROR' }
    }

    const syncReset = await supabase
      .from('exchange_accounts')
      .update({ last_synced: null, sync_status: 'pending', sync_error: null })
      .eq('id', accountId)
      .eq('user_id', userId)

    if (syncReset.error) {
      await supabase
        .from('exchange_accounts')
        .update({ last_synced: null })
        .eq('id', accountId)
        .eq('user_id', userId)
    }
  }

  return { success: true, data: { ...account, is_active: isActive } }
}

export async function updateExchangeApiKeys(
  supabase: SupabaseClient,
  userId: string,
  accountId: string,
  apiKey: string,
  apiSecret: string,
  passphrase?: string,
  label?: string,
  proxy?: string
): Promise<Result<{ account: ExchangeAccount; warnings: string[] }>> {
  void proxy
  const account = await getExchangeAccountById(supabase, accountId, userId)
  if (!account) {
    return { success: false, error: 'NOT_FOUND' }
  }

  const secret = prepareSecret(account.exchange, apiSecret)
  if (!secret.success) {
    return { success: false, error: secret.error }
  }

  if ((account.exchange === 'okx' || account.exchange === 'bitget') && !passphrase) {
    return { success: false, error: 'PASSPHRASE_REQUIRED' }
  }

  let adapter
  try {
    adapter = await createExchangeAdapter(account.exchange)
  } catch {
    return { success: false, error: 'UNSUPPORTED_EXCHANGE' }
  }

  const credentials: ExchangeCredentials = {
    apiKey,
    apiSecret: secret.data.stored,
    passphrase,
  }

  const validation = await validateCredentialsForAdapter(adapter, credentials)
  if (!validation.success) {
    return { success: false, error: validation.error }
  }

  const encryptedKey = encrypt(apiKey)
  const encryptedSecret = encrypt(secret.data.stored)
  const encryptedPassphrase = passphrase ? encrypt(passphrase) : null

  const serviceSupabase = (await import('@/lib/db/supabase-server')).createSupabaseServiceClient()

  const keyUpdated = await updateApiKeyRecord(
    serviceSupabase,
    accountId,
    encryptedKey.encrypted,
    encryptedSecret.encrypted,
    encryptedKey.iv,
    encryptedSecret.iv,
    encryptedPassphrase?.encrypted ?? null,
    encryptedPassphrase?.iv ?? null,
    secret.data.format
  )
  if (!keyUpdated) {
    return { success: false, error: 'INTERNAL_ERROR' }
  }

  if (label !== undefined) {
    await supabase
      .from('exchange_accounts')
      .update({ label: label ?? null })
      .eq('id', accountId)
      .eq('user_id', userId)
  }

  const updated = await getExchangeAccountById(supabase, accountId, userId)
  return {
    success: true,
    data: {
      account: updated ?? account,
      warnings: storedWarnings(validation.data),
    },
  }
}

export async function fetchExchangeBalance(
  supabase: SupabaseClient,
  userId: string,
  exchangeAccountId: string
): Promise<Result<ExchangeBalanceResult>> {
  const account = await getExchangeAccountById(supabase, exchangeAccountId, userId)
  if (!account) {
    return { success: false, error: 'NOT_FOUND' }
  }

  if (!account.is_active) {
    return { success: false, error: 'ACCOUNT_INACTIVE' }
  }

  const serviceSupabase = (await import('@/lib/db/supabase-server')).createSupabaseServiceClient()
  const loaded = await loadStoredCredentials(serviceSupabase, exchangeAccountId)
  if (!loaded.success) {
    return { success: false, error: loaded.error }
  }

  const adapter = await createExchangeAdapter(account.exchange)
  const assets = await adapter.fetchBalances(loaded.data)
  const totalUsd = assets.reduce((sum, asset) => sum + asset.usdValue, 0)

  return {
    success: true,
    data: {
      exchange_account_id: exchangeAccountId,
      exchange: account.exchange,
      total_usd: totalUsd,
      assets,
      fetched_at: new Date().toISOString(),
    },
  }
}

export async function fetchExchangePositions(
  supabase: SupabaseClient,
  userId: string,
  exchangeAccountId: string
): Promise<Result<ExchangePositionsResult>> {
  const account = await getExchangeAccountById(supabase, exchangeAccountId, userId)
  if (!account) {
    return { success: false, error: 'NOT_FOUND' }
  }

  if (!account.is_active) {
    return { success: false, error: 'ACCOUNT_INACTIVE' }
  }

  const serviceSupabase = (await import('@/lib/db/supabase-server')).createSupabaseServiceClient()
  const loaded = await loadStoredCredentials(serviceSupabase, exchangeAccountId)
  if (!loaded.success) {
    return { success: false, error: loaded.error }
  }

  const adapter = await createExchangeAdapter(account.exchange)
  const positions = await adapter.fetchOpenPositions(loaded.data)
  const totalUnrealizedPnl = positions.reduce((sum, position) => sum + position.unrealizedPnl, 0)

  return {
    success: true,
    data: {
      exchange_account_id: exchangeAccountId,
      total_unrealized_pnl: totalUnrealizedPnl,
      positions,
      fetched_at: new Date().toISOString(),
    },
  }
}

async function removeOrphanAccount(
  supabase: SupabaseClient,
  accountId: string,
  userId: string
): Promise<void> {
  try {
    await deleteExchangeAccount(supabase, accountId, userId)
  } catch {
    return
  }
}

async function loadStoredCredentials(
  supabase: SupabaseClient,
  exchangeAccountId: string
): Promise<Result<ExchangeCredentials, 'NO_KEY' | 'DECRYPTION_FAILED'>> {
  try {
    const apiKeyRow = await getApiKey(supabase, exchangeAccountId)
    if (!apiKeyRow) return { success: false, error: 'NO_KEY' }
    const credentials = decryptCredentials(apiKeyRow)
    if (!credentials) return { success: false, error: 'DECRYPTION_FAILED' }
    return { success: true, data: credentials }
  } catch {
    return { success: false, error: 'NO_KEY' }
  }
}

function decryptCredentials(apiKeyRow: {
  key_encrypted: string
  key_iv: string
  secret_encrypted: string
  secret_iv: string
  passphrase_encrypted: string | null
  passphrase_iv: string | null
}): ExchangeCredentials | null {
  try {
    const apiKey = decrypt(apiKeyRow.key_encrypted, apiKeyRow.key_iv)
    const apiSecret = decrypt(apiKeyRow.secret_encrypted, apiKeyRow.secret_iv)
    const passphrase =
      apiKeyRow.passphrase_encrypted && apiKeyRow.passphrase_iv
        ? decrypt(apiKeyRow.passphrase_encrypted, apiKeyRow.passphrase_iv)
        : undefined

    return {
      apiKey,
      apiSecret,
      passphrase,
    }
  } catch {
    return null
  }
}
