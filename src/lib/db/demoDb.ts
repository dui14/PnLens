import type { SupabaseClient } from '@supabase/supabase-js'
import { createServiceRoleClient } from '@/lib/db/serviceRoleClient'
import type {
  DemoCloseReason,
  DemoMutationOutcome,
  DemoTrade,
  DemoTradeStatus,
  Result,
} from '@/lib/types'

type DemoTradePatch = Partial<Omit<DemoTrade, 'id' | 'user_id' | 'created_at'>>
type DemoTradeInsert = Omit<DemoTrade, 'id' | 'created_at'>

let rpcClient: SupabaseClient | null = null

function getRpcClient(): SupabaseClient | null {
  if (!rpcClient) rpcClient = createServiceRoleClient()
  return rpcClient
}

function parseOutcome(payload: unknown): DemoMutationOutcome | null {
  if (!payload || typeof payload !== 'object') return null
  const { trade, balance } = payload as { trade?: DemoTrade; balance?: number | string }
  if (!trade) return null
  return { trade, balance: Number(balance ?? 0) }
}

export async function openDemoOrder(
  userId: string,
  cost: number,
  trade: DemoTradeInsert
): Promise<Result<DemoMutationOutcome>> {
  const client = getRpcClient()
  if (!client) return { success: false, error: 'INTERNAL_ERROR' }

  const { data, error } = await client.rpc('demo_open_order', {
    p_user_id: userId,
    p_cost: cost,
    p_trade: trade,
  })

  if (error) {
    console.error('[demoDb] openDemoOrder failed:', error.message)
    return { success: false, error: 'INTERNAL_ERROR' }
  }
  if ((data as { error?: string } | null)?.error === 'INSUFFICIENT_BALANCE') {
    return { success: false, error: 'INSUFFICIENT_BALANCE' }
  }
  const outcome = parseOutcome(data)
  if (!outcome) return { success: false, error: 'INTERNAL_ERROR' }
  return { success: true, data: outcome }
}


export async function getDemoTrades(
  supabase: SupabaseClient,
  userId: string,
  statuses?: DemoTradeStatus[]
): Promise<DemoTrade[]> {
  let query = supabase
    .from('demo_trades')
    .select('*')
    .eq('user_id', userId)
    .order('opened_at', { ascending: false })

  if (statuses && statuses.length > 0) {
    query = query.in('status', statuses)
  }

  const { data, error } = await query
  if (error) return []
  return (data ?? []) as DemoTrade[]
}

export async function getDemoTradeById(
  supabase: SupabaseClient,
  tradeId: string,
  userId: string
): Promise<DemoTrade | null> {
  const { data, error } = await supabase
    .from('demo_trades')
    .select('*')
    .eq('id', tradeId)
    .eq('user_id', userId)
    .single()

  if (error) return null
  return data as DemoTrade
}


export async function transitionDemoTrade(
  userId: string,
  tradeId: string,
  fromStatus: DemoTradeStatus,
  patch: DemoTradePatch,
  balanceDelta = 0
): Promise<DemoMutationOutcome | null> {
  const client = getRpcClient()
  if (!client) return null

  const { data, error } = await client.rpc('demo_transition_trade', {
    p_user_id: userId,
    p_trade_id: tradeId,
    p_from_status: fromStatus,
    p_patch: patch,
    p_balance_delta: balanceDelta,
  })

  if (error) {
    console.error('[demoDb] transitionDemoTrade failed:', error.message)
    return null
  }
  return parseOutcome(data)
}

export async function closeDemoTrade(
  userId: string,
  tradeId: string,
  updates: {
    exitPrice: number | null
    realizedPnl: number
    quantity: number
    initialMargin: number
    positionNotional: number
    status: 'open' | 'closed'
    closedAt: string | null
    closeReason: DemoCloseReason | null
  },
  balanceDelta: number
): Promise<DemoMutationOutcome | null> {
  return transitionDemoTrade(
    userId,
    tradeId,
    'open',
    {
      exit_price: updates.exitPrice,
      realized_pnl: updates.realizedPnl,
      quantity: updates.quantity,
      initial_margin: updates.initialMargin,
      position_notional: updates.positionNotional,
      status: updates.status,
      closed_at: updates.closedAt,
      close_reason: updates.closeReason,
    },
    balanceDelta
  )
}

export async function setDemoBalance(userId: string, balance: number): Promise<number | null> {
  const client = getRpcClient()
  if (!client) return null

  const { data, error } = await client.rpc('demo_set_balance', {
    p_user_id: userId,
    p_balance: balance,
  })

  if (error || data == null) {
    if (error) console.error('[demoDb] setDemoBalance failed:', error.message)
    return null
  }
  return Number(data)
}
