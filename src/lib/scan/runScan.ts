import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { decrypt } from '@/lib/adapters/encryption'
import { createExchangeAdapter } from '@/lib/adapters/exchangeFactory'
import { ExchangeWindowError } from '@/lib/adapters/exchangeWindowError'
import type { HistoryGap } from '@/lib/adapters/historyGaps'
import { emptyRejectCounts, type TradeRejectCounts } from '@/lib/adapters/tradeFields'
import { getApiKey, getExchangeAccountByAccountId, updateLastSynced, updateSyncStatus } from '@/lib/db/exchangeDb'
import { getKnownSpotSymbols, getLatestSpotTradeIdBefore, upsertTrades } from '@/lib/db/tradesDb'
import type { ExchangeAdapterTrade, ExchangeCredentials } from '@/lib/types'
import {
  EXCHANGE_SCAN_LIMITS,
  UPSERT_BATCH_SIZE,
  buildScanWindows,
  partialHistoryWarnings,
  scanStoredError,
  type ExchangeScanLimit,
} from './scanLimits'

export type ScanRunResult = {
  exchangeAccountId: string
  sync_status: 'synced' | 'error'
  sync_error: string | null
  rejected: TradeRejectCounts
  warnings: string[]
  synced_trades: number
  new_trades: number
}

export type RunScanOptions = {
  now?: Date
  client?: SupabaseClient
  limits?: ExchangeScanLimit
}

export async function runScan(accountId: string, options: RunScanOptions = {}): Promise<ScanRunResult> {
  const client = options.client ?? createServiceRoleClient()
  const now = options.now ?? new Date()
  const account = await getExchangeAccountByAccountId(client, accountId)
  if (!account) {
    return finishError(client, accountId, 'NOT_FOUND')
  }
  if (!account.is_active) {
    return finishError(client, accountId, 'ACCOUNT_INACTIVE')
  }

  const apiKeyRow = await getApiKey(client, accountId)
  if (!apiKeyRow) return finishError(client, accountId, 'NO_KEY')

  let credentials: ExchangeCredentials
  try {
    credentials = {
      apiKey: decrypt(apiKeyRow.key_encrypted, apiKeyRow.key_iv),
      apiSecret: decrypt(apiKeyRow.secret_encrypted, apiKeyRow.secret_iv),
      passphrase:
        apiKeyRow.passphrase_encrypted && apiKeyRow.passphrase_iv
          ? decrypt(apiKeyRow.passphrase_encrypted, apiKeyRow.passphrase_iv)
          : undefined,
    }
  } catch {
    return finishError(client, accountId, 'DECRYPTION_FAILED')
  }

  const limits = options.limits ?? EXCHANGE_SCAN_LIMITS[account.exchange]
  const plan = buildScanWindows({
    now,
    limits,
  })
  const adapter = await createExchangeAdapter(account.exchange)
  const rejected = emptyRejectCounts()
  let syncedTrades = 0
  let newTrades = 0
  const gaps: HistoryGap[] = []
  adapter.setSpotResume?.((symbol, beforeMs) =>
    getLatestSpotTradeIdBefore(client, accountId, symbol, beforeMs)
  )
  if (adapter.setKnownSpotSymbols) {
    adapter.setKnownSpotSymbols(await getKnownSpotSymbols(client, accountId))
  }

  try {
    for (const window of plan.windows) {
      const trades = await adapter.fetchTrades(credentials, window.start, window.end)
      gaps.push(...(adapter.historyGaps?.() ?? []))
      const pageRejected = adapter.rejectedTradeCounts()
      addCounts(rejected, pageRejected)
      const pageRejects = totalCount(pageRejected)
      if (trades.length === 0 && pageRejects > 0) {
        return finishError(client, accountId, 'WINDOW_REJECTED', rejected, plan.warnings, syncedTrades, newTrades)
      }
      const inserted = await upsertInBatches(client, accountId, account.user_id, trades)
      syncedTrades += trades.length
      newTrades += inserted
    }
  } catch (error) {
    const code = error instanceof ExchangeWindowError ? error.code : 'EXCHANGE_ERROR'
    console.error('[runScan] window failed:', code)
    return finishError(client, accountId, code, rejected, plan.warnings, syncedTrades, newTrades)
  }

  const skipped = totalCount(rejected)
  plan.warnings.push(...partialHistoryWarnings(gaps))
  const syncError = scanStoredError(skipped, plan.warnings)
  await updateLastSynced(client, accountId, 'synced', syncError)
  return {
    exchangeAccountId: accountId,
    sync_status: 'synced',
    sync_error: syncError,
    rejected,
    warnings: plan.warnings,
    synced_trades: syncedTrades,
    new_trades: newTrades,
  }
}

async function upsertInBatches(
  client: SupabaseClient,
  accountId: string,
  userId: string,
  trades: ExchangeAdapterTrade[]
): Promise<number> {
  let inserted = 0
  for (let index = 0; index < trades.length; index += UPSERT_BATCH_SIZE) {
    const batch = trades.slice(index, index + UPSERT_BATCH_SIZE)
    inserted += await upsertTrades(client, accountId, userId, batch)
  }
  return inserted
}

async function finishError(
  client: SupabaseClient,
  accountId: string,
  code: string,
  rejected: TradeRejectCounts = emptyRejectCounts(),
  warnings: string[] = [],
  syncedTrades = 0,
  newTrades = 0
): Promise<ScanRunResult> {
  await updateSyncStatus(client, accountId, 'error', code)
  return {
    exchangeAccountId: accountId,
    sync_status: 'error',
    sync_error: code,
    rejected,
    warnings,
    synced_trades: syncedTrades,
    new_trades: newTrades,
  }
}

function addCounts(target: TradeRejectCounts, page: TradeRejectCounts): void {
  target.INVALID_TIMESTAMP += page.INVALID_TIMESTAMP
  target.INVALID_NUMBER += page.INVALID_NUMBER
  target.MISSING_ID += page.MISSING_ID
}

function totalCount(counts: TradeRejectCounts): number {
  return counts.INVALID_TIMESTAMP + counts.INVALID_NUMBER + counts.MISSING_ID
}

function createServiceRoleClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new ExchangeWindowError()
  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  })
}
