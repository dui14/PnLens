import type { SupabaseClient } from '@supabase/supabase-js'
import type { Exchange } from '@/lib/types'
import type { ToolExchange, ToolPeriod } from '@/lib/tools/definitions'
import {
  TOOL_PNL_STATS_MAX_ROWS,
  TOOL_TRADE_LIMIT_DEFAULT,
  TOOL_TRADE_LIMIT_MAX,
  TOOL_TRADE_LIMIT_MIN,
} from '@/lib/ai/guardrails'

export type TradeToolContext = {
  supabase: SupabaseClient
  userId: string
}

type GetTradeHistoryArgs = {
  exchange?: ToolExchange
  symbol?: string
  limit?: number
}

type GetPnlStatsArgs = {
  period?: ToolPeriod
  exchange?: ToolExchange
}

type TradeRow = {
  symbol: string | null
  side: string | null
  price: number | null
  quantity: number | null
  realized_pnl: number | null
  traded_at: string | null
  exchange_accounts?: { exchange?: string } | Array<{ exchange?: string }> | null
}

type NormalizedTrade = {
  symbol: string
  side: 'buy' | 'sell'
  price: number
  quantity: number
  pnl: number | null
  date: string
  exchange: string
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

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

function mapToolExchange(exchange?: ToolExchange): Exchange | null {
  if (!exchange || exchange === 'all') return null
  if (exchange === 'binance') return 'binance'
  if (exchange === 'okx') return 'okx'
  if (exchange === 'bybit') return 'bybit'
  if (exchange === 'bitget') return 'bitget'
  if (exchange === 'gateio') return 'gateio'
  return null
}

function normalizeTradeRows(rows: TradeRow[]): NormalizedTrade[] {
  return rows
    .map((row) => {
      const exchangeData = Array.isArray(row.exchange_accounts)
        ? row.exchange_accounts[0]
        : row.exchange_accounts
      const side: 'buy' | 'sell' = row.side === 'sell' ? 'sell' : 'buy'

      return {
        symbol: (row.symbol ?? '').toUpperCase(),
        side,
        price: toFiniteNumber(row.price),
        quantity: toFiniteNumber(row.quantity),
        pnl: toNullableFiniteNumber(row.realized_pnl),
        date: row.traded_at ?? '',
        exchange:
          exchangeData && typeof exchangeData.exchange === 'string'
            ? exchangeData.exchange
            : 'unknown',
      }
    })
    .filter((row) => row.symbol.length > 0 && row.date.length > 0)
}

function getPeriodDays(period?: ToolPeriod): number {
  if (period === '7d') return 7
  if (period === '90d') return 90
  return 30
}

function getPeriodStartIso(days: number): string {
  const now = new Date()
  now.setHours(23, 59, 59, 999)

  const start = new Date(now)
  start.setDate(now.getDate() - (days - 1))
  start.setHours(0, 0, 0, 0)

  return start.toISOString()
}

function buildTradeSummaryRow(trade: NormalizedTrade): { symbol: string; pnl: number; date: string } {
  return {
    symbol: trade.symbol,
    pnl: trade.pnl ?? 0,
    date: trade.date,
  }
}

export async function getTradeHistoryTool(
  { supabase, userId }: TradeToolContext,
  args: GetTradeHistoryArgs
): Promise<Record<string, unknown>> {
  const symbol = args.symbol?.trim().toUpperCase()
  const limit = clampNumber(
    args.limit ?? TOOL_TRADE_LIMIT_DEFAULT,
    TOOL_TRADE_LIMIT_MIN,
    TOOL_TRADE_LIMIT_MAX
  )
  const exchangeFilter = mapToolExchange(args.exchange)

  let query = supabase
    .from('trades')
    .select(
      'symbol,side,price,quantity,realized_pnl,traded_at,exchange_accounts!inner(exchange,is_active)'
    )
    .eq('user_id', userId)
    .eq('exchange_accounts.is_active', true)
    .gt('quantity', 0)
    .gt('price', 0)
    .order('traded_at', { ascending: false })
    .limit(limit)

  if (exchangeFilter) {
    query = query.eq('exchange_accounts.exchange', exchangeFilter)
  }

  if (symbol) {
    query = query.ilike('symbol', `%${symbol}%`)
  }

  const { data, error } = await query

  if (error) {
    return {
      success: false,
      error: 'TRADE_HISTORY_UNAVAILABLE',
      detail: error.message,
      trades: [],
    }
  }

  const rows = normalizeTradeRows((data ?? []) as TradeRow[])
  const totalPnl = rows.reduce((sum, trade) => sum + (trade.pnl ?? 0), 0)

  return {
    success: true,
    exchange: args.exchange ?? 'all',
    symbol: symbol ?? null,
    count: rows.length,
    totalPnl: parseFloat(totalPnl.toFixed(8)),
    trades: rows,
  }
}

export async function getPnlStatsTool(
  { supabase, userId }: TradeToolContext,
  args: GetPnlStatsArgs
): Promise<Record<string, unknown>> {
  const period = args.period ?? '30d'
  const periodDays = getPeriodDays(period)
  const exchangeFilter = mapToolExchange(args.exchange)
  const periodStartIso = getPeriodStartIso(periodDays)

  let query = supabase
    .from('trades')
    .select(
      'symbol,side,price,quantity,realized_pnl,traded_at,exchange_accounts!inner(exchange,is_active)'
    )
    .eq('user_id', userId)
    .eq('exchange_accounts.is_active', true)
    .gte('traded_at', periodStartIso)
    .gt('quantity', 0)
    .gt('price', 0)
    .order('traded_at', { ascending: false })
    .limit(TOOL_PNL_STATS_MAX_ROWS)

  if (exchangeFilter) {
    query = query.eq('exchange_accounts.exchange', exchangeFilter)
  }

  const { data, error } = await query

  if (error) {
    return {
      success: false,
      error: 'PNL_STATS_UNAVAILABLE',
      detail: error.message,
    }
  }

  const rows = normalizeTradeRows((data ?? []) as TradeRow[])
  const closedTrades = rows.filter((trade) => trade.pnl !== null)
  const wins = closedTrades.filter((trade) => (trade.pnl ?? 0) > 0)
  const losses = closedTrades.filter((trade) => (trade.pnl ?? 0) < 0)

  const totalPnlRaw = closedTrades.reduce((sum, trade) => sum + (trade.pnl ?? 0), 0)
  const avgWinRaw = wins.length > 0 ? wins.reduce((sum, trade) => sum + (trade.pnl ?? 0), 0) / wins.length : 0
  const avgLossRaw =
    losses.length > 0 ? losses.reduce((sum, trade) => sum + (trade.pnl ?? 0), 0) / losses.length : 0
  const winRateRaw = closedTrades.length > 0 ? (wins.length / closedTrades.length) * 100 : 0

  const bestTrade =
    closedTrades.length > 0
      ? closedTrades.reduce((best, current) => {
          if (!best) return current
          return (current.pnl ?? 0) > (best.pnl ?? 0) ? current : best
        }, null as NormalizedTrade | null)
      : null

  const worstTrade =
    closedTrades.length > 0
      ? closedTrades.reduce((worst, current) => {
          if (!worst) return current
          return (current.pnl ?? 0) < (worst.pnl ?? 0) ? current : worst
        }, null as NormalizedTrade | null)
      : null

  return {
    success: true,
    period,
    exchange: args.exchange ?? 'all',
    totalTrades: rows.length,
    closedTrades: closedTrades.length,
    totalPnl: parseFloat(totalPnlRaw.toFixed(8)),
    winRate: parseFloat(winRateRaw.toFixed(2)),
    avgWin: parseFloat(avgWinRaw.toFixed(8)),
    avgLoss: parseFloat(avgLossRaw.toFixed(8)),
    bestTrade: bestTrade ? buildTradeSummaryRow(bestTrade) : null,
    worstTrade: worstTrade ? buildTradeSummaryRow(worstTrade) : null,
  }
}