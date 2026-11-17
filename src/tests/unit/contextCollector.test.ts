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
import { runAgentLoop, type AgentEvent } from '@/lib/agent-loop'
import type { SupabaseClient } from '@supabase/supabase-js'

const toolContext = { supabase: {} as SupabaseClient, userId: 'u1' }

function toolNames(message: string): string[] {
  return planContextTools(message).map((plan) => plan.tool)
}

describe('planContextTools', () => {
  it('always includes pnl stats and trade history', () => {
    expect(toolNames('how am I doing')).toEqual(['get_pnl_stats', 'get_trade_history'])
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
    const plans = planContextTools('gold price')
    const outcomes = await collectContext(toolContext, plans)
    const market = outcomes.find((o) => o.plan.tool === 'get_market_quotes')
    expect(market?.result).toBeNull()
    expect(market?.payload).toContain('unavailable')
    expect(outcomes.filter((o) => o.result).length).toBe(2)
  })

  it('bounds payload size', async () => {
    const tradeTool = await import('@/lib/tools/trade-tool')
    vi.mocked(tradeTool.getPnlStatsTool).mockResolvedValueOnce({ blob: 'x'.repeat(CONTEXT_PAYLOAD_MAX_CHARS * 2) })
    const outcomes = await collectContext(toolContext, planContextTools('hi'))
    expect(outcomes[0].payload.length).toBeLessThan(CONTEXT_PAYLOAD_MAX_CHARS + 200)
    expect(buildContextMessage(outcomes)).toContain('tool_data')
  })
})

describe('runAgentLoop single request', () => {
  it('performs exactly one provider fetch and accepts finish_reason length', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          choices: [{ finish_reason: 'length', message: { role: 'assistant', content: 'partial answer' } }],
          usage: { total_tokens: 5 },
        }),
        { status: 200 }
      )
    )
    vi.stubGlobal('fetch', fetchMock)
    const events: AgentEvent[] = []

    const result = await runAgentLoop(
      'gold price and news',
      [],
      toolContext,
      (event) => events.push(event),
      { provider: 'openrouter', apiKey: 'k', model: 'm' } as never
    )

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const body = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)
    expect(body.tools).toBeUndefined()
    expect(body.tool_choice).toBeUndefined()
    expect(result.success).toBe(true)
    const types = events.map((e) => e.type)
    expect(types[0]).toBe('thinking_start')
    expect(types.filter((t) => t === 'tool_start').length).toBe(4)
    expect(types.filter((t) => t === 'tool_done').length).toBe(4)
    expect(types[types.length - 1]).toBe('done')
    vi.unstubAllGlobals()
  })
})
