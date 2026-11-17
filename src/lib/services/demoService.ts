import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  DemoCloseReason,
  DemoMutationOutcome,
  DemoTrade,
  DemoTradeStatus,
  Result,
} from '@/lib/types'
import {
  closeDemoTrade,
  getDemoTradeById,
  getDemoTrades,
  openDemoOrder,
  setDemoBalance,
  transitionDemoTrade,
} from '@/lib/db/demoDb'
import { getUserDemoBalance } from '@/lib/db/usersDb'
import { fetchDemoPrice, fetchDemoPrices } from '@/lib/adapters/demoPrice'
import {
  calculateDemoEquity,
  calculateDemoLiquidationPrice,
  calculateDemoOrderCost,
  calculateDemoRealizedPNL,
  calculateDemoReservedForPending,
  calculateDemoSettleDelta,
  canRefillDemoBalance,
  evaluateDemoTrigger,
  isDemoLimitTriggered,
  resolveDemoLimitFillPrice,
  resolveDemoSizing,
  oppositeDemoSide,
  validateDemoBalance,
  validateDemoTpSlLevels,
  validateDemoTradeEdit,
  type DemoMarginMode,
  type DemoTradeEditPatch,
} from '@/lib/engines/demoEngine'
import { DEMO_REFILL_BALANCE, type DemoSizeMode } from '@/lib/config/demoTrading'

const CLOSE_EPSILON = 1e-10
const AMOUNT_PRECISION = 8
const QUANTITY_PRECISION = 10

type PlaceOrderInput = {
  symbol: string
  side: 'buy' | 'sell'
  orderType: 'market' | 'limit'
  marginMode: DemoMarginMode
  leverage: number
  sizeMode: DemoSizeMode
  size: number
  price: number | null
  takeProfit: number | null
  stopLoss: number | null
}

export type DemoEvaluationSummary = {
  filled: number
  closed: number
}

function marginModeOf(trade: DemoTrade): DemoMarginMode {
  return trade.margin_mode ?? 'cross'
}

async function activateDemoOrder(
  supabase: SupabaseClient,
  userId: string,
  trade: DemoTrade,
  marketPrice: number
): Promise<DemoMutationOutcome | null> {
  const notional = trade.position_notional ?? trade.quantity * trade.entry_price
  const margin = trade.initial_margin ?? 0
  const fillPrice = resolveDemoLimitFillPrice(trade.side, trade.entry_price, marketPrice)
  const quantity = parseFloat((notional / fillPrice).toFixed(QUANTITY_PRECISION))
  const balance = await getUserDemoBalance(supabase, userId)

  return transitionDemoTrade(userId, trade.id, 'pending', {
    status: 'open',
    entry_price: fillPrice,
    quantity,
    market_price_at_open: marketPrice,
    filled_at: new Date().toISOString(),
    liquidation_price: calculateDemoLiquidationPrice({
      side: trade.side,
      entryPrice: fillPrice,
      quantity,
      margin,
      marginMode: marginModeOf(trade),
      availableBalance: balance,
    }),
  })
}

export async function placeDemoOrder(
  supabase: SupabaseClient,
  userId: string,
  input: PlaceOrderInput
): Promise<Result<DemoMutationOutcome>> {
  const [marketPrice, knownBalance] = await Promise.all([
    fetchDemoPrice(input.symbol),
    input.marginMode === 'cross' ? getUserDemoBalance(supabase, userId) : Promise.resolve(null),
  ])
  if (marketPrice === null) {
    return { success: false, error: 'PRICE_UNAVAILABLE' }
  }

  const referencePrice = input.orderType === 'limit' && input.price ? input.price : marketPrice
  const sizing = resolveDemoSizing(input.sizeMode, input.size, input.leverage, referencePrice)
  if (!sizing) {
    return { success: false, error: 'INVALID_SIZE' }
  }

  const isMarket = input.orderType === 'market'
  const fillsNow = isMarket || isDemoLimitTriggered(input.side, referencePrice, marketPrice)

  const tpSlError = validateDemoTpSlLevels({
    side: input.side,
    entryPrice: referencePrice,
    markPrice: marketPrice,
    isOpen: fillsNow,
    takeProfit: input.takeProfit,
    stopLoss: input.stopLoss,
    liquidationPrice:
      input.stopLoss != null
        ? calculateDemoLiquidationPrice({
            side: input.side,
            entryPrice: referencePrice,
            quantity: sizing.quantity,
            margin: sizing.margin,
            marginMode: input.marginMode,
            availableBalance: (knownBalance ?? 0) - calculateDemoOrderCost(sizing.margin, sizing.notional),
          })
        : null,
  })
  if (tpSlError) {
    return { success: false, error: tpSlError }
  }

  if (knownBalance !== null && !validateDemoBalance(knownBalance, sizing.margin, sizing.notional)) {
    return { success: false, error: 'INSUFFICIENT_BALANCE' }
  }

  const now = new Date().toISOString()
  const fillPrice = isMarket ? marketPrice : resolveDemoLimitFillPrice(input.side, referencePrice, marketPrice)
  const entryPrice = fillsNow ? fillPrice : referencePrice
  const quantity = fillsNow ? sizing.notional / fillPrice : sizing.quantity
  const cost = calculateDemoOrderCost(sizing.margin, sizing.notional)

  return openDemoOrder(userId, cost, {
    user_id: userId,
    symbol: input.symbol,
    side: input.side,
    order_type: input.orderType,
    margin_mode: input.marginMode,
    leverage: input.leverage,
    quantity: parseFloat(quantity.toFixed(QUANTITY_PRECISION)),
    entry_price: entryPrice,
    initial_margin: parseFloat(sizing.margin.toFixed(AMOUNT_PRECISION)),
    position_notional: parseFloat(sizing.notional.toFixed(AMOUNT_PRECISION)),
    take_profit: input.takeProfit,
    stop_loss: input.stopLoss,
    market_price_at_open: marketPrice,
    exit_price: null,
    realized_pnl: null,
    status: fillsNow ? 'open' : 'pending',
    liquidation_price: fillsNow
      ? calculateDemoLiquidationPrice({
          side: input.side,
          entryPrice,
          quantity,
          margin: sizing.margin,
          marginMode: input.marginMode,
          availableBalance: (knownBalance ?? 0) - cost,
        })
      : null,
    close_reason: null,
    opened_at: now,
    filled_at: fillsNow ? now : null,
    closed_at: null,
    reduce_only: false,
    parent_trade_id: null,
  })
}

async function closeDemoPositionAtPrice(
  userId: string,
  trade: DemoTrade,
  exitPrice: number,
  reason: DemoCloseReason,
  closeQuantity?: number
): Promise<Result<DemoMutationOutcome>> {
  const quantityToClose = closeQuantity ?? trade.quantity

  if (
    !Number.isFinite(quantityToClose) ||
    quantityToClose <= 0 ||
    quantityToClose - trade.quantity > CLOSE_EPSILON
  ) {
    return { success: false, error: 'INVALID_CLOSE_QUANTITY' }
  }

  const closeRatio = quantityToClose / trade.quantity
  const safeLeverage = trade.leverage && trade.leverage > 0 ? trade.leverage : 1
  const totalNotional =
    trade.position_notional ??
    (trade.initial_margin != null
      ? trade.initial_margin * safeLeverage
      : trade.quantity * trade.entry_price)
  const totalMargin =
    trade.initial_margin ??
    (totalNotional > 0 ? totalNotional / safeLeverage : (trade.quantity * trade.entry_price) / safeLeverage)

  const realizedPnlForClose = calculateDemoRealizedPNL(trade, exitPrice, quantityToClose)
  const accumulatedRealizedPnl = parseFloat(
    ((trade.realized_pnl ?? 0) + realizedPnlForClose).toFixed(AMOUNT_PRECISION)
  )
  const releasedMargin = parseFloat((totalMargin * closeRatio).toFixed(AMOUNT_PRECISION))

  const remainingQuantityRaw = trade.quantity - quantityToClose
  const isFullyClosed = remainingQuantityRaw <= CLOSE_EPSILON
  const remainingQuantity = isFullyClosed
    ? 0
    : parseFloat(Math.max(remainingQuantityRaw, 0).toFixed(QUANTITY_PRECISION))
  const remainingMargin = isFullyClosed
    ? 0
    : parseFloat(Math.max(totalMargin - releasedMargin, 0).toFixed(AMOUNT_PRECISION))
  const remainingNotional = isFullyClosed
    ? 0
    : parseFloat(Math.max(totalNotional - totalNotional * closeRatio, 0).toFixed(AMOUNT_PRECISION))

  const settleDelta = calculateDemoSettleDelta({
    marginMode: marginModeOf(trade),
    releasedMargin,
    realizedPnl: realizedPnlForClose,
  })

  const closed = await closeDemoTrade(userId, trade.id, {
    exitPrice: isFullyClosed ? exitPrice : null,
    realizedPnl: accumulatedRealizedPnl,
    quantity: isFullyClosed ? quantityToClose : remainingQuantity,
    initialMargin: remainingMargin,
    positionNotional: remainingNotional,
    status: isFullyClosed ? 'closed' : 'open',
    closedAt: isFullyClosed ? new Date().toISOString() : null,
    closeReason: isFullyClosed ? reason : null,
  }, settleDelta)

  if (!closed) {
    return { success: false, error: 'TRADE_NOT_OPEN' }
  }

  return { success: true, data: closed }
}

export type DemoCloseRequest = {
  orderType?: 'market' | 'limit'
  price?: number | null
}

async function placeDemoCloseLimit(
  userId: string,
  trade: DemoTrade,
  closeQuantity: number,
  price: number
): Promise<Result<DemoMutationOutcome>> {
  if (
    !Number.isFinite(closeQuantity) ||
    closeQuantity <= 0 ||
    closeQuantity - trade.quantity > CLOSE_EPSILON
  ) {
    return { success: false, error: 'INVALID_CLOSE_QUANTITY' }
  }
  if (!Number.isFinite(price) || price <= 0) {
    return { success: false, error: 'INVALID_PRICE' }
  }
  const marketPrice = await fetchDemoPrice(trade.symbol)
  if (marketPrice === null) {
    return { success: false, error: 'PRICE_UNAVAILABLE' }
  }

  const placed = await openDemoOrder(userId, 0, {
    user_id: userId,
    symbol: trade.symbol,
    side: oppositeDemoSide(trade.side),
    order_type: 'limit',
    margin_mode: trade.margin_mode,
    leverage: trade.leverage,
    quantity: parseFloat(closeQuantity.toFixed(QUANTITY_PRECISION)),
    entry_price: price,
    initial_margin: 0,
    position_notional: 0,
    take_profit: null,
    stop_loss: null,
    market_price_at_open: marketPrice,
    exit_price: null,
    realized_pnl: null,
    status: 'pending',
    liquidation_price: null,
    close_reason: null,
    opened_at: new Date().toISOString(),
    filled_at: null,
    closed_at: null,
    reduce_only: true,
    parent_trade_id: trade.id,
  })
  if (!placed.success) return placed

  if (placed.data.trade.reduce_only !== true) {
    await cancelPendingTrade(userId, placed.data.trade)
    return { success: false, error: 'MIGRATION_REQUIRED' }
  }
  return placed
}

async function cancelReduceOrdersOf(
  supabase: SupabaseClient,
  userId: string,
  parentId: string
): Promise<void> {
  const pending = await getDemoTrades(supabase, userId, ['pending'])
  for (const order of pending) {
    if (order.reduce_only && order.parent_trade_id === parentId) {
      await cancelPendingTrade(userId, order)
    }
  }
}

export async function closeDemoOrder(
  supabase: SupabaseClient,
  userId: string,
  tradeId: string,
  closeQuantity?: number,
  request: DemoCloseRequest = {}
): Promise<Result<DemoMutationOutcome>> {
  const trade = await getDemoTradeById(supabase, tradeId, userId)
  if (!trade) {
    return { success: false, error: 'NOT_FOUND' }
  }
  if (trade.status !== 'open') {
    return { success: false, error: 'TRADE_NOT_OPEN' }
  }

  if (request.orderType === 'limit') {
    return placeDemoCloseLimit(userId, trade, closeQuantity ?? trade.quantity, request.price ?? NaN)
  }

  const exitPrice = await fetchDemoPrice(trade.symbol)
  if (exitPrice === null) {
    return { success: false, error: 'PRICE_UNAVAILABLE' }
  }

  const result = await closeDemoPositionAtPrice(userId, trade, exitPrice, 'manual', closeQuantity)
  if (result.success && result.data.trade.status === 'closed') {
    await cancelReduceOrdersOf(supabase, userId, trade.id)
  }
  return result
}

export async function updateDemoOrder(
  supabase: SupabaseClient,
  userId: string,
  tradeId: string,
  patch: DemoTradeEditPatch
): Promise<Result<DemoMutationOutcome>> {
  const trade = await getDemoTradeById(supabase, tradeId, userId)
  if (!trade) {
    return { success: false, error: 'NOT_FOUND' }
  }
  if (trade.status !== 'open' && trade.status !== 'pending') {
    return { success: false, error: 'TRADE_NOT_OPEN' }
  }
  const touchesLevels = patch.takeProfit !== undefined || patch.stopLoss !== undefined
  if ((trade.status === 'open' && patch.price !== undefined) || (trade.reduce_only && touchesLevels)) {
    return { success: false, error: 'VALIDATION_ERROR' }
  }

  const markPrice = await fetchDemoPrice(trade.symbol)
  const liquidationPrice =
    trade.status === 'open'
      ? (trade.liquidation_price ??
        calculateDemoLiquidationPrice({
          side: trade.side,
          entryPrice: trade.entry_price,
          quantity: trade.quantity,
          margin: trade.initial_margin ?? 0,
          marginMode: marginModeOf(trade),
          availableBalance: await getUserDemoBalance(supabase, userId),
        }))
      : null

  const invalid = trade.reduce_only
    ? patch.price !== undefined && !(patch.price > 0)
      ? 'INVALID_PRICE'
      : null
    : validateDemoTradeEdit(trade, patch, markPrice, liquidationPrice)
  if (invalid) {
    return { success: false, error: invalid }
  }

  const changes: Partial<DemoTrade> = {}
  if (patch.takeProfit !== undefined) changes.take_profit = patch.takeProfit
  if (patch.stopLoss !== undefined) changes.stop_loss = patch.stopLoss
  if (patch.price !== undefined) {
    changes.entry_price = patch.price
    if (!trade.reduce_only) {
      const notional = trade.position_notional ?? trade.quantity * trade.entry_price
      changes.quantity = parseFloat((notional / patch.price).toFixed(QUANTITY_PRECISION))
    }
  }

  const updated = await transitionDemoTrade(userId, trade.id, trade.status, changes)
  if (!updated) {
    return { success: false, error: trade.status === 'open' ? 'TRADE_NOT_OPEN' : 'TRADE_NOT_PENDING' }
  }
  return { success: true, data: updated }
}

async function cancelPendingTrade(
  userId: string,
  trade: DemoTrade
): Promise<DemoMutationOutcome | null> {
  return transitionDemoTrade(
    userId,
    trade.id,
    'pending',
    { status: 'cancelled', closed_at: new Date().toISOString() },
    parseFloat(calculateDemoReservedForPending(trade).toFixed(AMOUNT_PRECISION))
  )
}

export async function cancelDemoOrder(
  supabase: SupabaseClient,
  userId: string,
  tradeId: string
): Promise<Result<DemoMutationOutcome>> {
  const trade = await getDemoTradeById(supabase, tradeId, userId)
  if (!trade) {
    return { success: false, error: 'NOT_FOUND' }
  }
  if (trade.status !== 'pending') {
    return { success: false, error: 'TRADE_NOT_PENDING' }
  }

  const cancelled = await cancelPendingTrade(userId, trade)
  if (!cancelled) {
    return { success: false, error: 'TRADE_NOT_PENDING' }
  }
  return { success: true, data: cancelled }
}

export async function evaluateDemoOrders(
  supabase: SupabaseClient,
  userId: string
): Promise<Result<DemoEvaluationSummary>> {
  const active = await getDemoTrades(supabase, userId, ['pending', 'open'])
  if (active.length === 0) {
    return { success: true, data: { filled: 0, closed: 0 } }
  }

  const prices = await fetchDemoPrices(active.map((trade) => trade.symbol))
  let filled = 0
  let closed = 0

  let reduceFilled = 0

  for (const trade of active.filter((item) => item.status === 'pending')) {
    const price = prices[trade.symbol]
    if (trade.reduce_only) {
      const parent = trade.parent_trade_id
        ? await getDemoTradeById(supabase, trade.parent_trade_id, userId)
        : null
      if (!parent || parent.status !== 'open') {
        await cancelPendingTrade(userId, trade)
        continue
      }
      if (price === undefined || !isDemoLimitTriggered(trade.side, trade.entry_price, price)) continue
      const fillPrice = resolveDemoLimitFillPrice(trade.side, trade.entry_price, price)
      const closedParent = await closeDemoPositionAtPrice(
        userId,
        parent,
        fillPrice,
        'manual',
        Math.min(trade.quantity, parent.quantity)
      )
      if (!closedParent.success) continue
      const now = new Date().toISOString()
      await transitionDemoTrade(userId, trade.id, 'pending', {
        status: 'closed',
        exit_price: fillPrice,
        filled_at: now,
        closed_at: now,
        close_reason: 'manual',
      })
      reduceFilled += 1
      closed += 1
      continue
    }
    if (price === undefined || !isDemoLimitTriggered(trade.side, trade.entry_price, price)) continue
    const activated = await activateDemoOrder(supabase, userId, trade, price)
    if (activated) filled += 1
  }

  const positions =
    filled > 0 || reduceFilled > 0
      ? await getDemoTrades(supabase, userId, ['open'])
      : active.filter((item) => item.status === 'open')

  for (const trade of positions) {
    const price = prices[trade.symbol]
    if (price === undefined) continue

    const balance = await getUserDemoBalance(supabase, userId)
    const liquidationPrice =
      marginModeOf(trade) === 'isolated' && trade.liquidation_price != null
        ? trade.liquidation_price
        : calculateDemoLiquidationPrice({
            side: trade.side,
            entryPrice: trade.entry_price,
            quantity: trade.quantity,
            margin: trade.initial_margin ?? 0,
            marginMode: marginModeOf(trade),
            availableBalance: balance,
          })

    const trigger = evaluateDemoTrigger(trade, price, liquidationPrice)
    if (!trigger) continue

    const result = await closeDemoPositionAtPrice(userId, trade, trigger.exitPrice, trigger.reason)
    if (result.success) closed += 1
  }

  return { success: true, data: { filled, closed } }
}

export async function refillDemoBalance(
  supabase: SupabaseClient,
  userId: string
): Promise<Result<{ balance: number }>> {
  const active = await getDemoTrades(supabase, userId, ['pending', 'open'])
  const positions = active.filter((trade) => trade.status === 'open')
  const pending = active.filter((trade) => trade.status === 'pending')

  const prices = await fetchDemoPrices(positions.map((trade) => trade.symbol))
  if (positions.some((trade) => prices[trade.symbol] === undefined)) {
    return { success: false, error: 'PRICE_UNAVAILABLE' }
  }

  const balance = await getUserDemoBalance(supabase, userId)
  const equity = calculateDemoEquity({
    balance,
    positions: positions.map((trade) => ({ ...trade, markPrice: prices[trade.symbol] })),
    pending,
  })

  if (!canRefillDemoBalance(equity)) {
    return { success: false, error: 'REFILL_NOT_ALLOWED' }
  }

  for (const trade of pending) {
    await cancelPendingTrade(userId, trade)
  }
  for (const trade of positions) {
    await closeDemoPositionAtPrice(userId, trade, prices[trade.symbol], 'refill')
  }

  const updated = await setDemoBalance(userId, DEMO_REFILL_BALANCE)
  if (updated === null) {
    return { success: false, error: 'INTERNAL_ERROR' }
  }

  return { success: true, data: { balance: DEMO_REFILL_BALANCE } }
}

export async function listDemoOrders(
  supabase: SupabaseClient,
  userId: string,
  status?: DemoTradeStatus
): Promise<Result<DemoTrade[]>> {
  const trades = await getDemoTrades(supabase, userId, status ? [status] : undefined)
  return { success: true, data: trades }
}
