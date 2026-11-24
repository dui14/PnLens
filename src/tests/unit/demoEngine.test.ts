import { describe, expect, it } from 'vitest'
import {
  calculateDemoEquity,
  calculateDemoLiquidationPrice,
  calculateDemoOrderCost,
  calculateDemoRealizedPNL,
  calculateDemoSettleDelta,
  calculateDemoUnrealizedPNL,
  canRefillDemoBalance,
  clampDemoLeverage,
  evaluateDemoTrigger,
  isDemoLimitTriggered,
  resolveDemoLimitFillPrice,
  resolveDemoPercentSize,
  resolveDemoSizing,
  resolveDemoSizingPrice,
  settleDemoBalance,
  validateDemoTpSl,
} from '@/lib/engines/demoEngine'
import {
  DEMO_MAINTENANCE_MARGIN_RATE,
  DEMO_MAX_LEVERAGE,
  DEMO_REFILL_THRESHOLD,
  DEMO_SIZE_PERCENT_PRESETS,
  DEMO_TAKER_FEE_RATE,
} from '@/lib/config/demoTrading'

describe('resolveDemoSizing', () => {
  it('derives margin from value and leverage', () => {
    const sizing = resolveDemoSizing('value', 3000, 100, 65000)
    expect(sizing?.margin).toBeCloseTo(30, 8)
    expect(sizing?.notional).toBe(3000)
    expect(sizing?.quantity).toBeCloseTo(3000 / 65000, 10)
  })

  it('derives notional from cost and leverage', () => {
    const sizing = resolveDemoSizing('cost', 30, 100, 60000)
    expect(sizing?.notional).toBe(3000)
    expect(sizing?.quantity).toBeCloseTo(0.05, 10)
  })

  it('derives notional and margin from quantity', () => {
    const sizing = resolveDemoSizing('quantity', 0.5, 10, 2000)
    expect(sizing?.notional).toBe(1000)
    expect(sizing?.margin).toBe(100)
  })

  it('rejects invalid input', () => {
    expect(resolveDemoSizing('cost', 0, 10, 100)).toBeNull()
    expect(resolveDemoSizing('cost', 10, 10, 0)).toBeNull()
    expect(resolveDemoSizing('cost', Number.NaN, 10, 100)).toBeNull()
  })
})

describe('clampDemoLeverage', () => {
  it('clamps to the configured range', () => {
    expect(clampDemoLeverage(999)).toBe(DEMO_MAX_LEVERAGE)
    expect(clampDemoLeverage(0)).toBe(1)
    expect(clampDemoLeverage(Number.NaN)).toBe(1)
  })
})

describe('calculateDemoLiquidationPrice', () => {
  const base = { entryPrice: 100, quantity: 10, margin: 100, availableBalance: 900 }

  it('isolated long liquidates when loss consumes margin minus maintenance', () => {
    const maintenance = DEMO_MAINTENANCE_MARGIN_RATE * 10 * 100
    const expected = 100 - (100 - maintenance) / 10
    const liq = calculateDemoLiquidationPrice({ ...base, side: 'buy', marginMode: 'isolated' })
    expect(liq).toBeCloseTo(expected, 6)
  })

  it('isolated short liquidates above entry', () => {
    const maintenance = DEMO_MAINTENANCE_MARGIN_RATE * 10 * 100
    const expected = 100 + (100 - maintenance) / 10
    const liq = calculateDemoLiquidationPrice({ ...base, side: 'sell', marginMode: 'isolated' })
    expect(liq).toBeCloseTo(expected, 6)
  })

  it('cross uses free balance as extra buffer so liquidation is further away', () => {
    const isolated = calculateDemoLiquidationPrice({ ...base, side: 'buy', marginMode: 'isolated' }) as number
    const cross = calculateDemoLiquidationPrice({ ...base, side: 'buy', marginMode: 'cross' }) as number
    expect(cross).toBeLessThan(isolated)
    const maintenance = DEMO_MAINTENANCE_MARGIN_RATE * 10 * 100
    expect(cross).toBeCloseTo(100 - (100 + 900 - maintenance) / 10, 6)
  })

  it('cross short with large balance sits above isolated short', () => {
    const isolated = calculateDemoLiquidationPrice({ ...base, side: 'sell', marginMode: 'isolated' }) as number
    const cross = calculateDemoLiquidationPrice({ ...base, side: 'sell', marginMode: 'cross' }) as number
    expect(cross).toBeGreaterThan(isolated)
  })

  it('cross ignores negative available balance', () => {
    const cross = calculateDemoLiquidationPrice({ ...base, availableBalance: -50, side: 'buy', marginMode: 'cross' })
    const isolated = calculateDemoLiquidationPrice({ ...base, side: 'buy', marginMode: 'isolated' })
    expect(cross).toBe(isolated)
  })

  it('never returns a negative price for a long', () => {
    const liq = calculateDemoLiquidationPrice({ ...base, availableBalance: 1_000_000, side: 'buy', marginMode: 'cross' })
    expect(liq).toBe(0)
  })

  it('returns entry price when margin does not cover maintenance', () => {
    const liq = calculateDemoLiquidationPrice({
      side: 'buy',
      entryPrice: 100,
      quantity: 10,
      margin: 1,
      marginMode: 'isolated',
      availableBalance: 0,
    })
    expect(liq).toBe(100)
  })

  it('returns null for invalid inputs', () => {
    expect(
      calculateDemoLiquidationPrice({ ...base, quantity: 0, side: 'buy', marginMode: 'isolated' })
    ).toBeNull()
  })
})

describe('pnl', () => {
  it('computes unrealized pnl for both sides', () => {
    expect(calculateDemoUnrealizedPNL('buy', 100, 110, 2)).toBe(20)
    expect(calculateDemoUnrealizedPNL('sell', 100, 110, 2)).toBe(-20)
  })

  it('subtracts the exit fee from realized pnl', () => {
    const pnl = calculateDemoRealizedPNL({ side: 'buy', entry_price: 100, quantity: 2 }, 110)
    expect(pnl).toBeCloseTo(20 - 2 * 110 * DEMO_TAKER_FEE_RATE, 8)
  })

  it('adds the entry fee to the order cost', () => {
    expect(calculateDemoOrderCost(100, 1000)).toBeCloseTo(100 + 1000 * DEMO_TAKER_FEE_RATE, 8)
  })
})

describe('limit order fills', () => {
  it('buy limit fills only when price is at or below the limit', () => {
    expect(isDemoLimitTriggered('buy', 100, 101)).toBe(false)
    expect(isDemoLimitTriggered('buy', 100, 100)).toBe(true)
    expect(isDemoLimitTriggered('buy', 100, 99)).toBe(true)
  })

  it('sell limit fills only when price is at or above the limit', () => {
    expect(isDemoLimitTriggered('sell', 100, 99)).toBe(false)
    expect(isDemoLimitTriggered('sell', 100, 100)).toBe(true)
    expect(isDemoLimitTriggered('sell', 100, 101)).toBe(true)
  })

  it('fills at the better of limit and market', () => {
    expect(resolveDemoLimitFillPrice('buy', 100, 95)).toBe(95)
    expect(resolveDemoLimitFillPrice('sell', 100, 105)).toBe(105)
    expect(resolveDemoLimitFillPrice('buy', 100, 100)).toBe(100)
  })
})

describe('validateDemoTpSl', () => {
  it('requires TP above and SL below for longs', () => {
    expect(validateDemoTpSl('buy', 100, 110, 90)).toBe(true)
    expect(validateDemoTpSl('buy', 100, 90, null)).toBe(false)
    expect(validateDemoTpSl('buy', 100, null, 110)).toBe(false)
  })

  it('mirrors for shorts', () => {
    expect(validateDemoTpSl('sell', 100, 90, 110)).toBe(true)
    expect(validateDemoTpSl('sell', 100, 110, null)).toBe(false)
    expect(validateDemoTpSl('sell', 100, null, 90)).toBe(false)
  })
})

describe('evaluateDemoTrigger', () => {
  const long = { side: 'buy' as const, take_profit: 120, stop_loss: 90 }

  it('prioritizes liquidation and exits at the liquidation price', () => {
    expect(evaluateDemoTrigger(long, 85, 95)).toEqual({ reason: 'liquidation', exitPrice: 95 })
  })

  it('triggers stop loss and take profit at the current price', () => {
    expect(evaluateDemoTrigger(long, 89, 50)).toEqual({ reason: 'stop_loss', exitPrice: 89 })
    expect(evaluateDemoTrigger(long, 121, 50)).toEqual({ reason: 'take_profit', exitPrice: 121 })
  })

  it('returns null inside the range', () => {
    expect(evaluateDemoTrigger(long, 100, 50)).toBeNull()
  })

  it('handles shorts', () => {
    const short = { side: 'sell' as const, take_profit: 80, stop_loss: 110 }
    expect(evaluateDemoTrigger(short, 111, null)).toEqual({ reason: 'stop_loss', exitPrice: 111 })
    expect(evaluateDemoTrigger(short, 79, null)).toEqual({ reason: 'take_profit', exitPrice: 79 })
  })
})

describe('settleDemoBalance', () => {
  it('isolated never returns less than zero for a position', () => {
    const next = settleDemoBalance({ marginMode: 'isolated', balance: 500, releasedMargin: 100, realizedPnl: -250 })
    expect(next).toBe(500)
  })

  it('cross can consume free balance', () => {
    const next = settleDemoBalance({ marginMode: 'cross', balance: 500, releasedMargin: 100, realizedPnl: -250 })
    expect(next).toBe(350)
  })

  it('cross cannot go below zero', () => {
    const next = settleDemoBalance({ marginMode: 'cross', balance: 10, releasedMargin: 100, realizedPnl: -500 })
    expect(next).toBe(0)
  })
})

describe('equity and refill', () => {
  it('sums balance, margin, unrealized pnl and pending reservations', () => {
    const equity = calculateDemoEquity({
      balance: 100,
      positions: [{ side: 'buy', entry_price: 100, quantity: 1, initial_margin: 50, markPrice: 110 }],
      pending: [{ initial_margin: 20, position_notional: 1000 }],
    })
    expect(equity).toBeCloseTo(100 + 50 + 10 + 20 + 1000 * DEMO_TAKER_FEE_RATE, 8)
  })

  it('allows refill only below the threshold', () => {
    expect(canRefillDemoBalance(DEMO_REFILL_THRESHOLD - 0.01)).toBe(true)
    expect(canRefillDemoBalance(DEMO_REFILL_THRESHOLD)).toBe(false)
    expect(canRefillDemoBalance(Number.NaN)).toBe(false)
  })
})

describe('calculateDemoSettleDelta', () => {
  it('floors an isolated loss at zero return', () => {
    expect(calculateDemoSettleDelta({ marginMode: 'isolated', releasedMargin: 100, realizedPnl: -250 })).toBe(0)
  })

  it('lets a cross loss reduce the balance', () => {
    expect(calculateDemoSettleDelta({ marginMode: 'cross', releasedMargin: 100, realizedPnl: -250 })).toBe(-150)
  })
})

describe('resolveDemoSizingPrice', () => {
  const livePrice = 65000

  it('uses the live price for market orders', () => {
    expect(resolveDemoSizingPrice({ orderType: 'market', limitPrice: 60000, livePrice })).toBe(livePrice)
  })

  it('uses a valid limit price for limit orders', () => {
    expect(resolveDemoSizingPrice({ orderType: 'limit', limitPrice: 60000, livePrice })).toBe(60000)
  })

  it('falls back to the live price when the limit price is empty or invalid', () => {
    for (const limitPrice of [NaN, 0, -5, null, undefined]) {
      expect(resolveDemoSizingPrice({ orderType: 'limit', limitPrice, livePrice })).toBe(livePrice)
    }
  })

  it('returns null without any usable price', () => {
    expect(resolveDemoSizingPrice({ orderType: 'limit', limitPrice: NaN, livePrice: null })).toBeNull()
  })

  it('gives a percent size for a limit order with an empty price field', () => {
    const price = resolveDemoSizingPrice({ orderType: 'limit', limitPrice: parseFloat(''), livePrice }) as number
    const size = resolveDemoPercentSize({ mode: 'quantity', percent: 50, available: 1000, leverage: 10, price })
    expect(size).not.toBeNull()
  })
})

describe('resolveDemoPercentSize', () => {
  const available = 1000
  const price = 50000

  function spend(mode: 'quantity' | 'cost' | 'value', amount: number, leverage: number): number {
    const sizing = resolveDemoSizing(mode, amount, leverage, price)
    if (!sizing) throw new Error('sizing failed')
    return sizing.margin + sizing.notional * DEMO_TAKER_FEE_RATE
  }

  it('sizes cost as a share of the max cost after fees', () => {
    const maxCost = available / (1 + 10 * DEMO_TAKER_FEE_RATE)
    const half = resolveDemoPercentSize({ mode: 'cost', percent: 50, available, leverage: 10, price })
    expect(half).not.toBeNull()
    expect(half as number).toBeLessThanOrEqual(maxCost / 2)
    expect(half as number).toBeGreaterThan(maxCost / 2 - 0.01)
  })

  it('derives value as cost times leverage', () => {
    const cost = resolveDemoPercentSize({ mode: 'cost', percent: 25, available, leverage: 20, price }) as number
    const value = resolveDemoPercentSize({ mode: 'value', percent: 25, available, leverage: 20, price }) as number
    expect(value).toBeGreaterThan(cost * 20 - 0.05)
    expect(value).toBeLessThanOrEqual(cost * 20 + 0.2)
  })

  it('derives quantity from value and the reference price', () => {
    const quantity = resolveDemoPercentSize({ mode: 'quantity', percent: 50, available, leverage: 10, price }) as number
    const value = resolveDemoPercentSize({ mode: 'value', percent: 50, available, leverage: 10, price }) as number
    expect(quantity * price).toBeLessThan(value)
  })

  it.each(['quantity', 'cost', 'value'] as const)('never exceeds the balance at 100 percent in %s mode', (mode) => {
    for (const leverage of [1, 3, 10, 25, 100, 200]) {
      for (const bal of [37.77, 500, 1000, 1100, 9999.99]) {
        const amount = resolveDemoPercentSize({ mode, percent: 100, available: bal, leverage, price })
        expect(amount).not.toBeNull()
        expect(spend(mode, amount as number, leverage)).toBeLessThanOrEqual(bal)
      }
    }
  })

  it('stays within balance when the server price rises slightly in quantity mode', () => {
    const quantity = resolveDemoPercentSize({ mode: 'quantity', percent: 100, available, leverage: 10, price }) as number
    const sizing = resolveDemoSizing('quantity', quantity, 10, price * 1.0005)
    expect((sizing?.margin ?? 0) + (sizing?.notional ?? 0) * DEMO_TAKER_FEE_RATE).toBeLessThanOrEqual(available)
  })

  it('exposes ascending presets ending at 100', () => {
    expect([...DEMO_SIZE_PERCENT_PRESETS]).toEqual([10, 25, 50, 75, 100])
  })

  it('returns null for unusable inputs', () => {
    expect(resolveDemoPercentSize({ mode: 'cost', percent: 50, available: 0, leverage: 10, price })).toBeNull()
    expect(resolveDemoPercentSize({ mode: 'quantity', percent: 50, available, leverage: 10, price: 0 })).toBeNull()
    expect(resolveDemoPercentSize({ mode: 'cost', percent: 0, available, leverage: 10, price })).toBeNull()
  })
})
