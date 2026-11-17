import type { DemoCloseReason, DemoTrade } from '@/lib/types'
import {
  DEMO_MAINTENANCE_MARGIN_RATE,
  DEMO_QUANTITY_PRICE_BUFFER,
  DEMO_SIZE_FLOAT_GUARD,
  DEMO_SIZE_PRECISION,
  DEMO_MAX_LEVERAGE,
  DEMO_MIN_LEVERAGE,
  DEMO_REFILL_THRESHOLD,
  DEMO_TAKER_FEE_RATE,
  type DemoSizeMode,
} from '@/lib/config/demoTrading'

export type DemoSide = 'buy' | 'sell'
export type DemoMarginMode = 'cross' | 'isolated'

export type DemoSizing = {
  quantity: number
  notional: number
  margin: number
}

export type DemoTrigger = {
  reason: Extract<DemoCloseReason, 'liquidation' | 'stop_loss' | 'take_profit'>
  exitPrice: number
}

const PRICE_PRECISION = 8

function isPositive(value: number | null | undefined): value is number {
  return value != null && Number.isFinite(value) && value > 0
}

export function clampDemoLeverage(value: number): number {
  if (!Number.isFinite(value)) return DEMO_MIN_LEVERAGE
  return Math.min(DEMO_MAX_LEVERAGE, Math.max(DEMO_MIN_LEVERAGE, Math.round(value)))
}

export function resolveDemoSizing(
  mode: DemoSizeMode,
  amount: number,
  leverage: number,
  price: number
): DemoSizing | null {
  if (!isPositive(amount) || !isPositive(leverage) || !isPositive(price)) return null

  let notional: number
  if (mode === 'quantity') notional = amount * price
  else if (mode === 'cost') notional = amount * leverage
  else notional = amount

  const quantity = notional / price
  const margin = notional / leverage
  if (!isPositive(quantity) || !isPositive(margin) || !isPositive(notional)) return null
  return { quantity, notional, margin }
}

export function resolveDemoSizingPrice(params: {
  orderType: 'limit' | 'market'
  limitPrice: number | null | undefined
  livePrice: number | null | undefined
}): number | null {
  const { orderType, limitPrice, livePrice } = params
  if (orderType === 'limit' && isPositive(limitPrice)) return limitPrice
  return isPositive(livePrice) ? livePrice : null
}

function floorTo(value: number, decimals: number): number {
  const factor = 10 ** decimals
  return Math.floor(value * factor) / factor
}

export function resolveDemoPercentSize(params: {
  mode: DemoSizeMode
  percent: number
  available: number
  leverage: number
  price: number
}): number | null {
  const { mode, percent, available, leverage, price } = params
  if (!isPositive(percent) || !isPositive(available) || !isPositive(leverage) || !isPositive(price)) {
    return null
  }

  const maxCost = (available / (1 + leverage * DEMO_TAKER_FEE_RATE)) * DEMO_SIZE_FLOAT_GUARD
  const cost = (Math.min(percent, 100) / 100) * maxCost
  const value = cost * leverage

  let amount: number
  if (mode === 'cost') amount = cost
  else if (mode === 'value') amount = value
  else amount = (value / price) * DEMO_QUANTITY_PRICE_BUFFER

  const rounded = floorTo(amount, DEMO_SIZE_PRECISION[mode])
  return isPositive(rounded) ? rounded : null
}

export function calculateDemoEntryFee(positionNotional: number): number {
  return positionNotional * DEMO_TAKER_FEE_RATE
}

export function calculateDemoOrderCost(initialMargin: number, positionNotional: number): number {
  return initialMargin + calculateDemoEntryFee(positionNotional)
}

export function validateDemoBalance(
  balance: number,
  initialMargin: number,
  positionNotional: number
): boolean {
  return balance >= calculateDemoOrderCost(initialMargin, positionNotional)
}

export function calculateDemoUnrealizedPNL(
  side: DemoSide,
  entryPrice: number,
  markPrice: number,
  quantity: number
): number {
  const diff = side === 'buy' ? markPrice - entryPrice : entryPrice - markPrice
  return diff * quantity
}

export function calculateDemoRealizedPNL(
  trade: Pick<DemoTrade, 'side' | 'entry_price' | 'quantity'>,
  exitPrice: number,
  closeQuantity?: number
): number {
  const quantity = closeQuantity ?? trade.quantity
  const grossPNL = calculateDemoUnrealizedPNL(trade.side, trade.entry_price, exitPrice, quantity)
  const exitFee = quantity * exitPrice * DEMO_TAKER_FEE_RATE
  return parseFloat((grossPNL - exitFee).toFixed(PRICE_PRECISION))
}

export function calculateDemoLiquidationPrice(params: {
  side: DemoSide
  entryPrice: number
  quantity: number
  margin: number
  marginMode: DemoMarginMode
  availableBalance: number
}): number | null {
  const { side, entryPrice, quantity, margin, marginMode, availableBalance } = params
  if (!isPositive(entryPrice) || !isPositive(quantity) || !isPositive(margin)) return null

  const extraBuffer = marginMode === 'cross' ? Math.max(availableBalance, 0) : 0
  const wallet = margin + extraBuffer
  const maintenance = DEMO_MAINTENANCE_MARGIN_RATE * quantity * entryPrice
  const cushionPerUnit = Math.max(wallet - maintenance, 0) / quantity

  const raw = side === 'buy' ? entryPrice - cushionPerUnit : entryPrice + cushionPerUnit
  return parseFloat(Math.max(raw, 0).toFixed(PRICE_PRECISION))
}

export function isDemoLiquidated(
  side: DemoSide,
  markPrice: number,
  liquidationPrice: number | null
): boolean {
  if (!isPositive(liquidationPrice)) return false
  return side === 'buy' ? markPrice <= liquidationPrice : markPrice >= liquidationPrice
}

export function isDemoLimitTriggered(side: DemoSide, limitPrice: number, marketPrice: number): boolean {
  return side === 'buy' ? marketPrice <= limitPrice : marketPrice >= limitPrice
}

export function resolveDemoLimitFillPrice(
  side: DemoSide,
  limitPrice: number,
  marketPrice: number
): number {
  return side === 'buy' ? Math.min(limitPrice, marketPrice) : Math.max(limitPrice, marketPrice)
}

export function validateDemoTpSl(
  side: DemoSide,
  referencePrice: number,
  takeProfit: number | null,
  stopLoss: number | null
): boolean {
  const direction = side === 'buy' ? 1 : -1
  if (takeProfit != null && (takeProfit - referencePrice) * direction <= 0) return false
  if (stopLoss != null && (referencePrice - stopLoss) * direction <= 0) return false
  return true
}

export type DemoTpSlError =
  | 'INVALID_PRICE'
  | 'INVALID_TP'
  | 'INVALID_SL'
  | 'TP_SL_EQUAL'
  | 'SL_BEYOND_LIQUIDATION'

export function validateDemoTpSlLevels(params: {
  side: DemoSide
  entryPrice: number
  markPrice: number | null
  isOpen: boolean
  takeProfit: number | null | undefined
  stopLoss: number | null | undefined
  liquidationPrice: number | null
}): DemoTpSlError | null {
  const { side, entryPrice, markPrice, isOpen, liquidationPrice } = params
  const takeProfit = params.takeProfit ?? null
  const stopLoss = params.stopLoss ?? null
  if (takeProfit !== null && !isPositive(takeProfit)) return 'INVALID_PRICE'
  if (stopLoss !== null && !isPositive(stopLoss)) return 'INVALID_PRICE'
  if (takeProfit !== null && stopLoss !== null && takeProfit === stopLoss) return 'TP_SL_EQUAL'

  const direction = side === 'buy' ? 1 : -1
  const reference = isOpen && isPositive(markPrice) ? markPrice : entryPrice
  if (takeProfit !== null && (takeProfit - reference) * direction <= 0) return 'INVALID_TP'
  if (stopLoss !== null && (reference - stopLoss) * direction <= 0) return 'INVALID_SL'
  if (stopLoss !== null && isPositive(liquidationPrice) && (stopLoss - liquidationPrice) * direction <= 0) {
    return 'SL_BEYOND_LIQUIDATION'
  }
  return null
}

export type DemoTradeEditPatch = {
  takeProfit?: number | null
  stopLoss?: number | null
  price?: number
}

export function validateDemoTradeEdit(
  trade: Pick<DemoTrade, 'side' | 'status' | 'entry_price' | 'take_profit' | 'stop_loss'>,
  patch: DemoTradeEditPatch,
  markPrice: number | null,
  liquidationPrice: number | null
): DemoTpSlError | null {
  if (patch.price !== undefined && !isPositive(patch.price)) return 'INVALID_PRICE'
  return validateDemoTpSlLevels({
    side: trade.side,
    entryPrice: patch.price ?? trade.entry_price,
    markPrice,
    isOpen: trade.status === 'open',
    takeProfit: patch.takeProfit !== undefined ? patch.takeProfit : trade.take_profit,
    stopLoss: patch.stopLoss !== undefined ? patch.stopLoss : trade.stop_loss,
    liquidationPrice: trade.status === 'open' ? liquidationPrice : null,
  })
}

export function willDemoLimitFillImmediately(side: DemoSide, limitPrice: number, markPrice: number | null): boolean {
  return isPositive(markPrice) && isPositive(limitPrice) && isDemoLimitTriggered(side, limitPrice, markPrice)
}

export function oppositeDemoSide(side: DemoSide): DemoSide {
  return side === 'buy' ? 'sell' : 'buy'
}

export function evaluateDemoTrigger(
  trade: Pick<DemoTrade, 'side' | 'take_profit' | 'stop_loss'>,
  markPrice: number,
  liquidationPrice: number | null
): DemoTrigger | null {
  if (isDemoLiquidated(trade.side, markPrice, liquidationPrice) && liquidationPrice != null) {
    return { reason: 'liquidation', exitPrice: liquidationPrice }
  }

  const direction = trade.side === 'buy' ? 1 : -1
  if (trade.stop_loss != null && (markPrice - trade.stop_loss) * direction <= 0) {
    return { reason: 'stop_loss', exitPrice: markPrice }
  }
  if (trade.take_profit != null && (markPrice - trade.take_profit) * direction >= 0) {
    return { reason: 'take_profit', exitPrice: markPrice }
  }
  return null
}

export function calculateDemoSettleDelta(params: {
  marginMode: DemoMarginMode
  releasedMargin: number
  realizedPnl: number
}): number {
  const { marginMode, releasedMargin, realizedPnl } = params
  const returned = releasedMargin + realizedPnl
  const delta = marginMode === 'isolated' ? Math.max(returned, 0) : returned
  return parseFloat(delta.toFixed(PRICE_PRECISION))
}

export function settleDemoBalance(params: {
  marginMode: DemoMarginMode
  balance: number
  releasedMargin: number
  realizedPnl: number
}): number {
  const { balance, ...rest } = params
  return parseFloat(Math.max(balance + calculateDemoSettleDelta(rest), 0).toFixed(PRICE_PRECISION))
}

export function calculateDemoReservedForPending(trade: Pick<DemoTrade, 'initial_margin' | 'position_notional'>): number {
  const margin = trade.initial_margin ?? 0
  const notional = trade.position_notional ?? 0
  return margin + calculateDemoEntryFee(notional)
}

export function calculateDemoEquity(params: {
  balance: number
  positions: Array<Pick<DemoTrade, 'side' | 'entry_price' | 'quantity' | 'initial_margin'> & { markPrice: number | null }>
  pending: Array<Pick<DemoTrade, 'initial_margin' | 'position_notional'>>
}): number {
  const { balance, positions, pending } = params
  const inPositions = positions.reduce((sum, position) => {
    const margin = position.initial_margin ?? 0
    const unrealized =
      position.markPrice != null
        ? calculateDemoUnrealizedPNL(position.side, position.entry_price, position.markPrice, position.quantity)
        : 0
    return sum + margin + unrealized
  }, 0)
  const inPending = pending.reduce((sum, order) => sum + calculateDemoReservedForPending(order), 0)
  return balance + inPositions + inPending
}

export function canRefillDemoBalance(equity: number): boolean {
  return Number.isFinite(equity) && equity < DEMO_REFILL_THRESHOLD
}

export function resolveDemoTradeLiquidation(
  trade: Pick<DemoTrade, 'side' | 'status' | 'entry_price' | 'quantity' | 'initial_margin' | 'margin_mode' | 'liquidation_price'>,
  availableBalance: number
): number | null {
  if (trade.status !== 'open') return null
  if (isPositive(trade.liquidation_price)) return trade.liquidation_price
  return calculateDemoLiquidationPrice({
    side: trade.side,
    entryPrice: trade.entry_price,
    quantity: trade.quantity,
    margin: trade.initial_margin ?? 0,
    marginMode: trade.margin_mode ?? 'cross',
    availableBalance,
  })
}

function demoActivityTime(trade: Pick<DemoTrade, 'opened_at' | 'filled_at' | 'closed_at'>): number {
  const parsed = Date.parse(trade.closed_at ?? trade.filled_at ?? trade.opened_at)
  return Number.isFinite(parsed) ? parsed : 0
}

export function sortDemoTradesByActivity<T extends Pick<DemoTrade, 'opened_at' | 'filled_at' | 'closed_at'>>(
  trades: T[]
): T[] {
  return [...trades].sort((a, b) => demoActivityTime(b) - demoActivityTime(a))
}
