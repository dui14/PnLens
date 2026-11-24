import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { DemoTrade } from '@/lib/types'
import { DEMO_REFILL_BALANCE } from '@/lib/config/demoTrading'

const mocks = vi.hoisted(() => ({
  openDemoOrder: vi.fn(),
  setDemoBalance: vi.fn(),
  getDemoTrades: vi.fn(),
  getDemoTradeById: vi.fn(),
  transitionDemoTrade: vi.fn(),
  closeDemoTrade: vi.fn(),
  getUserDemoBalance: vi.fn(),
  fetchDemoPrice: vi.fn(),
  fetchDemoPrices: vi.fn(),
}))

vi.mock('@/lib/db/demoDb', () => ({
  openDemoOrder: mocks.openDemoOrder,
  setDemoBalance: mocks.setDemoBalance,
  getDemoTrades: mocks.getDemoTrades,
  getDemoTradeById: mocks.getDemoTradeById,
  transitionDemoTrade: mocks.transitionDemoTrade,
  closeDemoTrade: mocks.closeDemoTrade,
}))
vi.mock('@/lib/db/usersDb', () => ({
  getUserDemoBalance: mocks.getUserDemoBalance,
}))
vi.mock('@/lib/adapters/demoPrice', () => ({
  fetchDemoPrice: mocks.fetchDemoPrice,
  fetchDemoPrices: mocks.fetchDemoPrices,
}))

import {
  cancelDemoOrder,
  closeDemoOrder,
  evaluateDemoOrders,
  placeDemoOrder,
  refillDemoBalance,
  updateDemoOrder,
} from '@/lib/services/demoService'

const supabase = {} as SupabaseClient
const USER = 'user-1'

function trade(overrides: Partial<DemoTrade>): DemoTrade {
  return {
    id: 't1',
    user_id: USER,
    symbol: 'BTCUSDT',
    side: 'buy',
    order_type: 'limit',
    margin_mode: 'isolated',
    leverage: 10,
    quantity: 1,
    entry_price: 100,
    initial_margin: 10,
    position_notional: 100,
    take_profit: null,
    stop_loss: null,
    market_price_at_open: 100,
    exit_price: null,
    realized_pnl: null,
    status: 'pending',
    liquidation_price: null,
    close_reason: null,
    opened_at: '2026-01-01T00:00:00Z',
    filled_at: null,
    closed_at: null,
    created_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

const baseInput = {
  symbol: 'BTCUSDT',
  side: 'buy' as const,
  orderType: 'limit' as const,
  marginMode: 'isolated' as const,
  leverage: 10,
  sizeMode: 'cost' as const,
  size: 100,
  price: 90,
  takeProfit: null,
  stopLoss: null,
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getUserDemoBalance.mockResolvedValue(10000)
  mocks.setDemoBalance.mockResolvedValue(DEMO_REFILL_BALANCE)
  mocks.openDemoOrder.mockImplementation(async (_user, cost, row) => ({
    success: true,
    data: { trade: trade({ ...row, id: 'new' }), balance: 10000 - cost },
  }))
})

describe('placeDemoOrder', () => {
  it('keeps a buy limit below market pending and reserves margin plus fee', async () => {
    mocks.fetchDemoPrice.mockResolvedValue(100)
    const result = await placeDemoOrder(supabase, USER, baseInput)

    expect(result.success).toBe(true)
    const row = mocks.openDemoOrder.mock.calls[0][2]
    expect(row.status).toBe('pending')
    expect(row.filled_at).toBeNull()
    expect(row.entry_price).toBe(90)
    expect(mocks.openDemoOrder.mock.calls[0][1]).toBeCloseTo(100 + 1000 * 0.001, 8)
    expect(result.success && result.data.balance).toBeCloseTo(10000 - 101, 8)
  })

  it('fills a buy limit above market immediately at the market price', async () => {
    mocks.fetchDemoPrice.mockResolvedValue(100)
    await placeDemoOrder(supabase, USER, { ...baseInput, price: 110 })
    const row = mocks.openDemoOrder.mock.calls[0][2]
    expect(row.status).toBe('open')
    expect(row.entry_price).toBe(100)
    expect(row.liquidation_price).not.toBeNull()
  })

  it('opens market orders at the server price', async () => {
    mocks.fetchDemoPrice.mockResolvedValue(250)
    await placeDemoOrder(supabase, USER, { ...baseInput, orderType: 'market', price: null })
    const row = mocks.openDemoOrder.mock.calls[0][2]
    expect(row.status).toBe('open')
    expect(row.entry_price).toBe(250)
  })

  it('fails when the price source is unavailable', async () => {
    mocks.fetchDemoPrice.mockResolvedValue(null)
    const result = await placeDemoOrder(supabase, USER, baseInput)
    expect(result).toEqual({ success: false, error: 'PRICE_UNAVAILABLE' })
    expect(mocks.openDemoOrder).not.toHaveBeenCalled()
  })

  it('rejects insufficient balance early for cross orders without calling the rpc', async () => {
    mocks.fetchDemoPrice.mockResolvedValue(100)
    mocks.getUserDemoBalance.mockResolvedValue(50)
    const result = await placeDemoOrder(supabase, USER, { ...baseInput, marginMode: 'cross' })
    expect(result).toEqual({ success: false, error: 'INSUFFICIENT_BALANCE' })
    expect(mocks.openDemoOrder).not.toHaveBeenCalled()
  })

  it('skips the balance read for isolated orders and relies on the rpc check', async () => {
    mocks.fetchDemoPrice.mockResolvedValue(100)
    mocks.openDemoOrder.mockResolvedValue({ success: false, error: 'INSUFFICIENT_BALANCE' })
    const result = await placeDemoOrder(supabase, USER, baseInput)
    expect(result).toEqual({ success: false, error: 'INSUFFICIENT_BALANCE' })
    expect(mocks.getUserDemoBalance).not.toHaveBeenCalled()
  })

  it('rejects take profit on the wrong side', async () => {
    mocks.fetchDemoPrice.mockResolvedValue(100)
    const result = await placeDemoOrder(supabase, USER, { ...baseInput, takeProfit: 50 })
    expect(result).toEqual({ success: false, error: 'INVALID_TP' })
  })
})

describe('cancelDemoOrder', () => {
  it('refunds margin and fee', async () => {
    const pending = trade({})
    mocks.getDemoTradeById.mockResolvedValue(pending)
    mocks.transitionDemoTrade.mockResolvedValue({ trade: { ...pending, status: 'cancelled' }, balance: 910.1 })

    const result = await cancelDemoOrder(supabase, USER, 't1')
    expect(result.success).toBe(true)
    expect(mocks.transitionDemoTrade).toHaveBeenCalledWith(
      USER,
      't1',
      'pending',
      expect.objectContaining({ status: 'cancelled' }),
      10 + 0.1
    )
  })

  it('rejects orders that are not pending', async () => {
    mocks.getDemoTradeById.mockResolvedValue(trade({ status: 'open' }))
    const result = await cancelDemoOrder(supabase, USER, 't1')
    expect(result).toEqual({ success: false, error: 'TRADE_NOT_PENDING' })
  })
})

describe('evaluateDemoOrders', () => {
  it('fills a pending buy limit when the price crosses it', async () => {
    mocks.getDemoTrades.mockResolvedValueOnce([trade({})]).mockResolvedValueOnce([])
    mocks.fetchDemoPrices.mockResolvedValue({ BTCUSDT: 95 })
    mocks.transitionDemoTrade.mockResolvedValue({ trade: trade({ status: 'open' }), balance: 10000 })

    const result = await evaluateDemoOrders(supabase, USER)
    expect(result).toEqual({ success: true, data: { filled: 1, closed: 0 } })
    expect(mocks.transitionDemoTrade.mock.calls[0][3]).toMatchObject({ status: 'open', entry_price: 95 })
  })

  it('leaves a pending buy limit when the price is above it', async () => {
    mocks.getDemoTrades.mockResolvedValueOnce([trade({})])
    mocks.fetchDemoPrices.mockResolvedValue({ BTCUSDT: 105 })

    const result = await evaluateDemoOrders(supabase, USER)
    expect(result).toEqual({ success: true, data: { filled: 0, closed: 0 } })
    expect(mocks.transitionDemoTrade).not.toHaveBeenCalled()
  })

  it('closes a position that hits its stop loss', async () => {
    const position = trade({ status: 'open', stop_loss: 90, order_type: 'market', liquidation_price: 50 })
    mocks.getDemoTrades.mockResolvedValueOnce([position])
    mocks.fetchDemoPrices.mockResolvedValue({ BTCUSDT: 89 })
    mocks.closeDemoTrade.mockResolvedValue({ trade: { ...position, status: 'closed' }, balance: 10000 })

    const result = await evaluateDemoOrders(supabase, USER)
    expect(result).toEqual({ success: true, data: { filled: 0, closed: 1 } })
    expect(mocks.closeDemoTrade.mock.calls[0][2]).toMatchObject({ status: 'closed', closeReason: 'stop_loss' })
  })

  it('liquidates an isolated position at its liquidation price', async () => {
    const position = trade({ status: 'open', order_type: 'market', liquidation_price: 91 })
    mocks.getDemoTrades.mockResolvedValueOnce([position])
    mocks.fetchDemoPrices.mockResolvedValue({ BTCUSDT: 80 })
    mocks.closeDemoTrade.mockResolvedValue({ trade: { ...position, status: 'closed' }, balance: 10000 })

    await evaluateDemoOrders(supabase, USER)
    expect(mocks.closeDemoTrade.mock.calls[0][2]).toMatchObject({ exitPrice: 91, closeReason: 'liquidation' })
  })
})

describe('refillDemoBalance', () => {
  it('rejects when equity is at or above the threshold', async () => {
    mocks.getDemoTrades.mockResolvedValue([])
    mocks.fetchDemoPrices.mockResolvedValue({})
    mocks.getUserDemoBalance.mockResolvedValue(600)

    const result = await refillDemoBalance(supabase, USER)
    expect(result).toEqual({ success: false, error: 'REFILL_NOT_ALLOWED' })
    expect(mocks.setDemoBalance).not.toHaveBeenCalled()
  })

  it('resets the balance when equity is below the threshold', async () => {
    mocks.getDemoTrades.mockResolvedValue([])
    mocks.fetchDemoPrices.mockResolvedValue({})
    mocks.getUserDemoBalance.mockResolvedValue(120)

    const result = await refillDemoBalance(supabase, USER)
    expect(result).toEqual({ success: true, data: { balance: DEMO_REFILL_BALANCE } })
    expect(mocks.setDemoBalance).toHaveBeenLastCalledWith(USER, DEMO_REFILL_BALANCE)
  })

  it('counts open position margin and pnl toward equity', async () => {
    const position = trade({ status: 'open', initial_margin: 300 })
    mocks.getDemoTrades.mockResolvedValue([position])
    mocks.fetchDemoPrices.mockResolvedValue({ BTCUSDT: 100 })
    mocks.getUserDemoBalance.mockResolvedValue(300)

    const result = await refillDemoBalance(supabase, USER)
    expect(result).toEqual({ success: false, error: 'REFILL_NOT_ALLOWED' })
  })
})

describe('placeDemoOrder reduce-only columns', () => {
  it('sends explicit non-null reduce_only so the rpc insert satisfies NOT NULL', async () => {
    mocks.fetchDemoPrice.mockResolvedValue(100)
    await placeDemoOrder(supabase, USER, baseInput)
    const row = mocks.openDemoOrder.mock.calls[0][2]
    expect(row.reduce_only).toBe(false)
    expect(row.parent_trade_id).toBeNull()
  })
})

describe('closeDemoOrder limit', () => {
  const position = trade({ status: 'open', order_type: 'market', quantity: 2 })

  it('places a pending reduce-only order on the opposite side with no margin', async () => {
    mocks.getDemoTradeById.mockResolvedValue(position)
    mocks.fetchDemoPrice.mockResolvedValue(100)
    const result = await closeDemoOrder(supabase, USER, 't1', 1, { orderType: 'limit', price: 120 })
    expect(result.success).toBe(true)
    const [, cost, row] = mocks.openDemoOrder.mock.calls[0]
    expect(cost).toBe(0)
    expect(row).toMatchObject({
      side: 'sell',
      status: 'pending',
      entry_price: 120,
      quantity: 1,
      reduce_only: true,
      parent_trade_id: 't1',
      initial_margin: 0,
    })
  })

  it('rejects an invalid price and an oversized quantity', async () => {
    mocks.getDemoTradeById.mockResolvedValue(position)
    mocks.fetchDemoPrice.mockResolvedValue(100)
    expect(await closeDemoOrder(supabase, USER, 't1', 1, { orderType: 'limit', price: 0 })).toEqual({
      success: false,
      error: 'INVALID_PRICE',
    })
    expect(await closeDemoOrder(supabase, USER, 't1', 5, { orderType: 'limit', price: 10 })).toEqual({
      success: false,
      error: 'INVALID_CLOSE_QUANTITY',
    })
  })

  it('cancels the row and reports a migration error when the column is missing', async () => {
    mocks.getDemoTradeById.mockResolvedValue(position)
    mocks.fetchDemoPrice.mockResolvedValue(100)
    mocks.openDemoOrder.mockResolvedValue({
      success: true,
      data: { trade: trade({ id: 'new', reduce_only: false }), balance: 1 },
    })
    mocks.transitionDemoTrade.mockResolvedValue({ trade: trade({ status: 'cancelled' }), balance: 1 })
    const result = await closeDemoOrder(supabase, USER, 't1', 1, { orderType: 'limit', price: 120 })
    expect(result).toEqual({ success: false, error: 'MIGRATION_REQUIRED' })
    expect(mocks.transitionDemoTrade).toHaveBeenCalled()
  })
})

describe('updateDemoOrder', () => {
  it('rejects a stop loss on the wrong side of the mark', async () => {
    mocks.getDemoTradeById.mockResolvedValue(trade({ status: 'open', liquidation_price: 50 }))
    mocks.fetchDemoPrice.mockResolvedValue(100)
    const result = await updateDemoOrder(supabase, USER, 't1', { stopLoss: 150 })
    expect(result).toEqual({ success: false, error: 'INVALID_SL' })
    expect(mocks.transitionDemoTrade).not.toHaveBeenCalled()
  })

  it('updates tp/sl on an open position', async () => {
    mocks.getDemoTradeById.mockResolvedValue(trade({ status: 'open', liquidation_price: 50 }))
    mocks.fetchDemoPrice.mockResolvedValue(100)
    mocks.transitionDemoTrade.mockResolvedValue({ trade: trade({ status: 'open', stop_loss: 90 }), balance: 1 })
    const result = await updateDemoOrder(supabase, USER, 't1', { stopLoss: 90, takeProfit: 130 })
    expect(result.success).toBe(true)
    expect(mocks.transitionDemoTrade).toHaveBeenCalledWith(USER, 't1', 'open', { stop_loss: 90, take_profit: 130 })
  })

  it('reprices a pending order and recomputes quantity from notional', async () => {
    mocks.getDemoTradeById.mockResolvedValue(trade({ status: 'pending', position_notional: 100, entry_price: 100 }))
    mocks.fetchDemoPrice.mockResolvedValue(120)
    mocks.transitionDemoTrade.mockResolvedValue({ trade: trade({ entry_price: 50 }), balance: 1 })
    await updateDemoOrder(supabase, USER, 't1', { price: 50 })
    expect(mocks.transitionDemoTrade).toHaveBeenCalledWith(USER, 't1', 'pending', { entry_price: 50, quantity: 2 })
  })

  it('refuses a price change on an open position', async () => {
    mocks.getDemoTradeById.mockResolvedValue(trade({ status: 'open' }))
    const result = await updateDemoOrder(supabase, USER, 't1', { price: 50 })
    expect(result).toEqual({ success: false, error: 'VALIDATION_ERROR' })
  })
})
