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
import { createExchangeAdapter, type ExchangeAdapter } from '@/lib/adapters/exchangeFactory'
import type { CredentialProbeResult } from '@/lib/adapters/credentialValidation'

const STORED_WARNINGS = ['PERMISSIONS_UNVERIFIED', 'IP_RESTRICT_DISABLED', 'IP_WHITELIST_MISSING'] as const

function getSyncLookbackDate(): Date {
  const lookback = new Date()
  lookback.setUTCFullYear(lookback.getUTCFullYear() - 1)
  return lookback
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
    apiSecret,
    passphrase,
  }

  const validation = await validateCredentialsForAdapter(adapter, credentials)
  if (!validation.success) {
    return { success: false, error: validation.error }
  }

  const encryptedKey = encrypt(apiKey)
  const encryptedSecret = encrypt(apiSecret)
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
      null
    )
    if (!keyCreated) {
      await deleteExchangeAccount(supabase, account.id, userId)
      return { success: false, error: 'INTERNAL_ERROR' }
    }
  } catch (error) {
    await deleteExchangeAccount(supabase, account.id, userId)
    throw error
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
  const accounts = await getExchangeAccounts(supabase, userId)
  return { success: true, data: accounts }
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
  const apiKeyRow = await getApiKey(serviceSupabase, exchangeAccountId)
  if (!apiKeyRow) {
    await updateSyncStatus(supabase, exchangeAccountId, 'error', 'API_KEY_NOT_FOUND')
    return { success: false, error: 'API_KEY_NOT_FOUND' }
  }

  const credentials = decryptCredentials(apiKeyRow)
  if (!credentials) {
    await updateSyncStatus(supabase, exchangeAccountId, 'error', 'DECRYPTION_FAILED')
    return { success: false, error: 'DECRYPTION_FAILED' }
  }

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

  const trackingDeleted = await deleteExchangeTrackingData(supabase, userId, accountId)
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
    const deleted = await deleteExchangeTrackingData(supabase, userId, accountId)
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
): Promise<Result<ExchangeAccount>> {
  const account = await getExchangeAccountById(supabase, accountId, userId)
  if (!account) {
    return { success: false, error: 'NOT_FOUND' }
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
    apiSecret,
    passphrase,
    proxy,
  }

  const validation = await validateCredentialsForAdapter(adapter, credentials)
  if (!validation.success) {
    return { success: false, error: validation.error }
  }

  const encryptedKey = encrypt(apiKey)
  const encryptedSecret = encrypt(apiSecret)
  const encryptedPassphrase = passphrase ? encrypt(passphrase) : null
  const encryptedProxy = proxy ? encrypt(proxy) : null

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
    encryptedProxy?.encrypted ?? null,
    encryptedProxy?.iv ?? null
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
  return { success: true, data: updated ?? account }
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
  const apiKeyRow = await getApiKey(serviceSupabase, exchangeAccountId)
  if (!apiKeyRow) {
    return { success: false, error: 'API_KEY_NOT_FOUND' }
  }

  const credentials = decryptCredentials(apiKeyRow)
  if (!credentials) {
    return { success: false, error: 'DECRYPTION_FAILED' }
  }

  const adapter = await createExchangeAdapter(account.exchange)
  const assets = await adapter.fetchBalances(credentials)
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
  const apiKeyRow = await getApiKey(serviceSupabase, exchangeAccountId)
  if (!apiKeyRow) {
    return { success: false, error: 'API_KEY_NOT_FOUND' }
  }

  const credentials = decryptCredentials(apiKeyRow)
  if (!credentials) {
    return { success: false, error: 'DECRYPTION_FAILED' }
  }

  const adapter = await createExchangeAdapter(account.exchange)
  const positions = await adapter.fetchOpenPositions(credentials)
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

function decryptCredentials(apiKeyRow: {
  key_encrypted: string
  key_iv: string
  secret_encrypted: string
  secret_iv: string
  passphrase_encrypted: string | null
  passphrase_iv: string | null
  proxy_encrypted: string | null
  proxy_iv: string | null
}): ExchangeCredentials | null {
  try {
    const apiKey = decrypt(apiKeyRow.key_encrypted, apiKeyRow.key_iv)
    const apiSecret = decrypt(apiKeyRow.secret_encrypted, apiKeyRow.secret_iv)
    const passphrase =
      apiKeyRow.passphrase_encrypted && apiKeyRow.passphrase_iv
        ? decrypt(apiKeyRow.passphrase_encrypted, apiKeyRow.passphrase_iv)
        : undefined
    const proxy =
      apiKeyRow.proxy_encrypted && apiKeyRow.proxy_iv
        ? decrypt(apiKeyRow.proxy_encrypted, apiKeyRow.proxy_iv)
        : undefined

    return {
      apiKey,
      apiSecret,
      passphrase,
      proxy,
    }
  } catch {
    return null
  }
}
