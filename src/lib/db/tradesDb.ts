import type { SupabaseClient } from '@supabase/supabase-js'
import type { Exchange, ExchangeAdapterTrade, Result, Trade } from '@/lib/types'
import { encodeTradeCursor, keysetFilter, type TradeCursor } from '@/lib/pagination/tradeCursor'

type TradeTypeFilter = 'spot' | 'futures'

type TradeReadFilter = {
  exchangeAccountId?: string
  tradeType?: TradeTypeFilter
  exchange?: Exchange
  includeInactive?: boolean
}

const TRADE_QUERY_BATCH_SIZE = 1000
const TRADES_FETCH_FAILED = 'TRADES_FETCH_FAILED'
const PNL_TRADE_COLUMNS =
  'id, symbol, side, quantity, price, fee, fee_currency, funding_fee, realized_pnl, trade_type, traded_at'

function toFiniteNumber(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value ?? 0)
  return Number.isFinite(parsed) ? parsed : 0
}

function toNullableFiniteNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return null
  return parsed
}

function hasMissingColumnError(error: unknown, column: string): boolean {
  if (!error || typeof error !== 'object') return false
  const message = 'message' in error ? String(error.message ?? '') : ''
  const lowerMessage = message.toLowerCase()
  return message.includes(column) && (lowerMessage.includes('column') || lowerMessage.includes('schema cache'))
}

function hasMissingTableError(error: unknown, table: string): boolean {
  if (!error || typeof error !== 'object') return false

  const code = 'code' in error ? String(error.code ?? '') : ''
  if (code === '42P01' || code === 'PGRST205') return true

  const message = 'message' in error ? String(error.message ?? '').toLowerCase() : ''
  const hint = 'hint' in error ? String(error.hint ?? '').toLowerCase() : ''
  const tableName = table.toLowerCase()

  const referencesTable = message.includes(tableName) || hint.includes(tableName)
  const missingSignal =
    message.includes('does not exist') ||
    message.includes('not found') ||
    hint.includes('does not exist') ||
    hint.includes('not found')

  return referencesTable && missingSignal
}

export async function upsertTrades(
  supabase: SupabaseClient,
  exchangeAccountId: string,
  userId: string,
  trades: ExchangeAdapterTrade[]
): Promise<number> {
  if (trades.length === 0) return 0

  const rows = trades.map((t) => ({
    exchange_account_id: exchangeAccountId,
    user_id: userId,
    external_trade_id: t.external_trade_id,
    symbol: t.symbol,
    side: t.side,
    quantity: t.quantity,
    price: t.price,
    fee: t.fee,
    fee_currency: t.fee_currency,
    realized_pnl: t.realized_pnl,
    funding_fee: t.funding_fee ?? 0,
    income_type: t.income_type ?? null,
    trade_type: t.trade_type,
    traded_at: t.traded_at,
    raw_data: t.raw_data,
  }))

  const { data, error } = await supabase
    .from('trades')
    .upsert(rows, {
      onConflict: 'exchange_account_id,external_trade_id',
    })
    .select('id')

  if (error) {
    const missingFundingColumns =
      hasMissingColumnError(error, 'funding_fee') || hasMissingColumnError(error, 'income_type')

    if (missingFundingColumns) {
      const fallbackRows = trades.map((t) => ({
        exchange_account_id: exchangeAccountId,
        user_id: userId,
        external_trade_id: t.external_trade_id,
        symbol: t.symbol,
        side: t.side,
        quantity: t.quantity,
        price: t.price,
        fee: t.fee,
        fee_currency: t.fee_currency,
        realized_pnl: t.realized_pnl,
        trade_type: t.trade_type,
        traded_at: t.traded_at,
        raw_data: t.raw_data,
      }))

      const fallback = await supabase
        .from('trades')
        .upsert(fallbackRows, {
          onConflict: 'exchange_account_id,external_trade_id',
        })
        .select('id')

      if (fallback.error) {
        console.error('[tradesDb] upsertTrades fallback failed:', fallback.error.message)
        throw new Error(fallback.error.message)
      }

      return fallback.data?.length ?? 0
    }

    console.error('[tradesDb] upsertTrades failed:', error.message)
    throw new Error(error.message)
  }
  return data?.length ?? 0
}

export async function getTradeCount(
  supabase: SupabaseClient,
  exchangeAccountId: string
): Promise<number> {
  const { count, error } = await supabase
    .from('trades')
    .select('id', { count: 'exact', head: true })
    .eq('exchange_account_id', exchangeAccountId)

  if (error) return 0
  return count ?? 0
}

export async function getTrades(
  supabase: SupabaseClient,
  userId: string,
  options: {
    limit: number
    cursor?: TradeCursor
    exchangeAccountId?: string
    symbol?: string
    tradeType?: TradeTypeFilter
    exchange?: Exchange
    includeInactive?: boolean
    executedOnly?: boolean
  }
): Promise<{ trades: Trade[]; nextCursor: string | null }> {
  let query = supabase
    .from('trades')
    .select(
      `${PNL_TRADE_COLUMNS}, exchange_accounts!inner(exchange,is_active)`,
    )
    .eq('user_id', userId)
    .order('traded_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(options.limit + 1)

  if (options.cursor) {
    query = query.or(keysetFilter(options.cursor, 'desc'))
  }

  if (!options.includeInactive) {
    query = query.eq('exchange_accounts.is_active', true)
  }

  if (options.exchangeAccountId) {
    query = query.eq('exchange_account_id', options.exchangeAccountId)
  }
  if (options.exchange) {
    query = query.eq('exchange_accounts.exchange', options.exchange)
  }
  if (options.symbol) {
    query = query.ilike('symbol', `%${options.symbol}%`)
  }
  if (options.tradeType) {
    query = query.eq('trade_type', options.tradeType)
  }

  if (options.executedOnly) {
    query = query.gt('quantity', 0).gt('price', 0)
  }

  const { data, error } = await query
  if (error) {
    console.error('[tradesDb] getTrades failed:', error.message)
    return { trades: [], nextCursor: null }
  }

  const fetched = (data ?? []) as Record<string, unknown>[]
  const hasMore = fetched.length > options.limit
  const pageRows = hasMore ? fetched.slice(0, options.limit) : fetched
  const lastRow = pageRows[pageRows.length - 1]
  const nextCursor =
    hasMore && lastRow
      ? encodeTradeCursor({ tradedAt: String(lastRow.traded_at), id: String(lastRow.id) })
      : null

  const trades = pageRows.map((row) => {
    const record = row as Record<string, unknown>
    const accountData = record.exchange_accounts as Record<string, unknown> | Record<string, unknown>[] | null
    const exchangeRow = Array.isArray(accountData) ? accountData[0] : accountData
    const quantity = toFiniteNumber(record.quantity)
    const price = toFiniteNumber(record.price)
    const fee = toFiniteNumber(record.fee)
    const fundingFee = toFiniteNumber(record.funding_fee)
    const realizedPnl = toNullableFiniteNumber(record.realized_pnl)

    return {
      ...record,
      quantity,
      price,
      fee,
      funding_fee: fundingFee,
      realized_pnl: realizedPnl,
      exchange:
        exchangeRow && typeof exchangeRow.exchange === 'string'
          ? (exchangeRow.exchange as Exchange)
          : undefined,
      exchange_accounts: undefined,
    }
  }) as unknown as Trade[]

  return { trades, nextCursor }
}

export async function fetchTradesForPNL(
  supabase: SupabaseClient,
  userId: string,
  options: TradeReadFilter & {
    startDate?: string
    endDate?: string
    executedOnly?: boolean
  }
): Promise<Result<Trade[]>> {
  const rows: Record<string, unknown>[] = []
  let cursor: TradeCursor | null = null

  while (true) {
    let query = supabase
      .from('trades')
      .select(`${PNL_TRADE_COLUMNS}, exchange_accounts!inner(exchange,is_active)`)
      .eq('user_id', userId)
      .order('traded_at', { ascending: true })
      .order('id', { ascending: true })
      .limit(TRADE_QUERY_BATCH_SIZE)

    if (cursor) {
      query = query.or(keysetFilter(cursor, 'asc'))
    }

    if (!options.includeInactive) {
      query = query.eq('exchange_accounts.is_active', true)
    }

    if (options.startDate) {
      query = query.gte('traded_at', options.startDate)
    }
    if (options.endDate) {
      query = query.lte('traded_at', options.endDate)
    }
    if (options.exchangeAccountId) {
      query = query.eq('exchange_account_id', options.exchangeAccountId)
    }
    if (options.exchange) {
      query = query.eq('exchange_accounts.exchange', options.exchange)
    }
    if (options.tradeType) {
      query = query.eq('trade_type', options.tradeType)
    }

    if (options.executedOnly) {
      query = query.gt('quantity', 0).gt('price', 0)
    }

    const { data, error } = await query

    if (error) {
      console.error('[tradesDb] getTradesForPNL failed:', error.message)
      return { success: false, error: TRADES_FETCH_FAILED }
    }

    const pageRows = (data ?? []) as Record<string, unknown>[]
    rows.push(...pageRows)

    if (pageRows.length < TRADE_QUERY_BATCH_SIZE) {
      break
    }

    const last = pageRows[pageRows.length - 1]
    cursor = { tradedAt: String(last.traded_at), id: String(last.id) }
  }

  const trades = rows.map((row) => {
    const record = row as Record<string, unknown>
    const accountData = record.exchange_accounts as Record<string, unknown> | Record<string, unknown>[] | null
    const exchangeRow = Array.isArray(accountData) ? accountData[0] : accountData
    const quantity = toFiniteNumber(record.quantity)
    const price = toFiniteNumber(record.price)
    const fee = toFiniteNumber(record.fee)
    const fundingFee = toFiniteNumber(record.funding_fee)
    const realizedPnl = toNullableFiniteNumber(record.realized_pnl)

    return {
      ...record,
      quantity,
      price,
      fee,
      funding_fee: fundingFee,
      realized_pnl: realizedPnl,
      exchange:
        exchangeRow && typeof exchangeRow.exchange === 'string'
          ? (exchangeRow.exchange as Exchange)
          : undefined,
      exchange_accounts: undefined,
    }
  }) as unknown as Trade[]

  return { success: true, data: trades }
}

export async function getTradesForPNL(
  supabase: SupabaseClient,
  userId: string,
  options: Parameters<typeof fetchTradesForPNL>[2]
): Promise<Trade[]> {
  const result = await fetchTradesForPNL(supabase, userId, options)
  return result.success ? result.data : []
}

export async function getTradeTotals(
  supabase: SupabaseClient,
  userId: string,
  options: TradeReadFilter & {
    executedOnly?: boolean
  }
): Promise<{ count: number; volumeUsd: number }> {
  let volumeUsd = 0
  let totalCount = 0
  let lastId = null as string | null

  while (true) {
    const isFirstBatch: boolean = lastId === null
    let query = supabase
      .from('trades')
      .select('id, quantity, price, exchange_accounts!inner(exchange,is_active)', {
        count: isFirstBatch ? 'exact' : undefined,
      })
      .eq('user_id', userId)
      .order('id', { ascending: true })
      .limit(TRADE_QUERY_BATCH_SIZE)

    if (lastId !== null) {
      query = query.gt('id', lastId)
    }

    if (!options.includeInactive) {
      query = query.eq('exchange_accounts.is_active', true)
    }

    if (options.exchangeAccountId) {
      query = query.eq('exchange_account_id', options.exchangeAccountId)
    }
    if (options.exchange) {
      query = query.eq('exchange_accounts.exchange', options.exchange)
    }
    if (options.tradeType) {
      query = query.eq('trade_type', options.tradeType)
    }

    if (options.executedOnly) {
      query = query.gt('quantity', 0).gt('price', 0)
    }

    const { data, error, count } = await query

    if (error) {
      console.error('[tradesDb] getTradeTotals failed:', error.message)
      return { count: 0, volumeUsd: 0 }
    }

    if (isFirstBatch) {
      totalCount = count ?? 0
    }

    const pageRows = data ?? []
    for (const row of pageRows) {
      const quantity = toFiniteNumber((row as Record<string, unknown>).quantity)
      const price = toFiniteNumber((row as Record<string, unknown>).price)
      volumeUsd += quantity * price
    }

    if (pageRows.length < TRADE_QUERY_BATCH_SIZE) {
      break
    }

    const lastRow = pageRows[pageRows.length - 1] as Record<string, unknown>
    lastId = String(lastRow.id)
  }

  return {
    count: totalCount,
    volumeUsd: parseFloat(volumeUsd.toFixed(8)),
  }
}

export async function deleteExchangeTrackingData(
  supabase: SupabaseClient,
  snapshotClient: SupabaseClient,
  userId: string,
  exchangeAccountId: string
): Promise<boolean> {
  const deleteTradesResult = await supabase
    .from('trades')
    .delete()
    .eq('user_id', userId)
    .eq('exchange_account_id', exchangeAccountId)

  if (deleteTradesResult.error) {
    console.error('[tradesDb] deleteExchangeTrackingData(trades) failed:', deleteTradesResult.error.message)
    return false
  }

  const deleteSnapshotsResult = await snapshotClient
    .from('pnl_snapshots')
    .delete()
    .eq('user_id', userId)

  if (deleteSnapshotsResult.error && !hasMissingTableError(deleteSnapshotsResult.error, 'pnl_snapshots')) {
    console.error('[tradesDb] deleteExchangeTrackingData(pnl_snapshots) failed:', deleteSnapshotsResult.error.message)
    return false
  }

  return true
}

const SPOT_TRADE_ID_PREFIX = 'spot_'

export async function getLatestSpotTradeIdBefore(
  supabase: SupabaseClient,
  exchangeAccountId: string,
  symbol: string,
  beforeMs: number
): Promise<number> {
  const { data, error } = await supabase
    .from('trades')
    .select('external_trade_id')
    .eq('exchange_account_id', exchangeAccountId)
    .eq('symbol', symbol)
    .eq('trade_type', 'spot')
    .lt('traded_at', new Date(beforeMs).toISOString())
    .order('traded_at', { ascending: false })
    .limit(1)

  if (error || !data || data.length === 0) return 0
  const raw = String((data[0] as Record<string, unknown>).external_trade_id ?? '')
  if (!raw.startsWith(SPOT_TRADE_ID_PREFIX)) return 0
  const parsed = Number(raw.slice(SPOT_TRADE_ID_PREFIX.length))
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
}

export async function getKnownSpotSymbols(
  supabase: SupabaseClient,
  exchangeAccountId: string
): Promise<string[]> {
  const symbols = new Set<string>()
  for (let from = 0; ; from += TRADE_QUERY_BATCH_SIZE) {
    const { data, error } = await supabase
      .from('trades')
      .select('symbol')
      .eq('exchange_account_id', exchangeAccountId)
      .eq('trade_type', 'spot')
      .order('symbol', { ascending: true })
      .order('id', { ascending: true })
      .range(from, from + TRADE_QUERY_BATCH_SIZE - 1)
    if (error || !data) return Array.from(symbols)
    for (const row of data as { symbol?: unknown }[]) {
      if (typeof row.symbol === 'string' && row.symbol.length > 0) symbols.add(row.symbol)
    }
    if (data.length < TRADE_QUERY_BATCH_SIZE) break
  }
  return Array.from(symbols)
}
