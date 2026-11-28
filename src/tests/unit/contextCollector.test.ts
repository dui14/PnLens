import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/tools/trade-tool', () => ({
  getTradeHistoryTool: vi.fn(async () => ({ count: 1, items: [{ symbol: 'BTCUSDT' }] })),
  getPnlStatsTool: vi.fn(async () => ({ winRate: 50, totalPnl: 10, count: 2 })),
}))
vi.mock('@/lib/tools/market-tool', () => ({
  getMarketQuotesTool: vi.fn(async () => {
    throw new Error('market down')
  }),
}))
vi.mock('@/lib/tools/news-tool', () => ({
  getCryptoNewsTool: vi.fn(async () => ({ count: 0, items: [] })),
}))

import {
  CONTEXT_PAYLOAD_MAX_CHARS,
  buildContextMessage,
  collectContext,
  planContextTools,
} from '@/lib/ai/contextCollector'
import type { SupabaseClient } from '@supabase/supabase-js'

const toolContext = { supabase: {} as SupabaseClient, userId: 'u1' }

function toolNames(message: string): string[] {
  return planContextTools(message).map((plan) => plan.tool)
}

describe('planContextTools', () => {
  it('plans nothing for a greeting', () => {
    expect(planContextTools('hi')).toEqual([])
  })

  it('does not match performance keywords inside other words', () => {
    expect(planContextTools('hello there')).toEqual([])
  })

  it('plans pnl stats and trade history for performance questions', () => {
    expect(toolNames('How is my PNL over the last 30 days?')).toEqual(['get_pnl_stats', 'get_trade_history'])
    expect(toolNames('how am I doing')).toEqual(['get_pnl_stats', 'get_trade_history'])
  })

  it('plans only market quotes for a BTC price message', () => {
    const names = toolNames('BTC price')
    expect(names).toContain('get_market_quotes')
    expect(names).not.toContain('get_pnl_stats')
  })

  it('adds market quotes for English and Vietnamese keywords', () => {
    expect(toolNames('what is the XAUUSD price')).toContain('get_market_quotes')
    expect(toolNames('giá vàng hôm nay')).toContain('get_market_quotes')
  })

  it('adds news for English and Vietnamese keywords', () => {
    expect(toolNames('any crypto news?')).toContain('get_crypto_news')
    expect(toolNames('cho tôi tin tức')).toContain('get_crypto_news')
  })
})

describe('collectContext', () => {
  it('skips failed tools and marks them unavailable', async () => {
    const plans = planContextTools('gold price pnl')
    const outcomes = await collectContext(toolContext, plans)
    const market = outcomes.find((o) => o.plan.tool === 'get_market_quotes')
    expect(market?.result).toBeNull()
    expect(market?.payload).toContain('unavailable')
    expect(outcomes.filter((o) => o.result).length).toBe(2)
  })

  it('bounds payload size', async () => {
    const tradeTool = await import('@/lib/tools/trade-tool')
    vi.mocked(tradeTool.getPnlStatsTool).mockResolvedValueOnce({ blob: 'x'.repeat(CONTEXT_PAYLOAD_MAX_CHARS * 2) })
    const outcomes = await collectContext(toolContext, planContextTools('my pnl'))
    expect(outcomes[0].payload.length).toBeLessThan(CONTEXT_PAYLOAD_MAX_CHARS + 200)
    expect(buildContextMessage(outcomes)).toContain('tool_data')
  })
})
