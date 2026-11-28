import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/tools/trade-tool', () => ({
  getTradeHistoryTool: vi.fn(async () => ({ count: 1, items: [{ symbol: 'BTCUSDT' }] })),
  getPnlStatsTool: vi.fn(async () => ({ winRate: 50, totalPnl: 10, count: 2 })),
}))
vi.mock('@/lib/tools/market-tool', () => ({
  getMarketQuotesTool: vi.fn(async () => ({ count: 1, items: [{ symbol: 'BTC-USD', price: 1 }] })),
}))
vi.mock('@/lib/tools/news-tool', () => ({
  getCryptoNewsTool: vi.fn(async () => ({ count: 0, items: [] })),
}))
vi.mock('@/lib/ai/modelGating', () => ({
  findModelEntry: vi.fn((_provider: string, model: string) =>
    model === 'no-tools' ? { id: model, label: model, supportsEffort: false, supportsTools: false } : null
  ),
}))

import { runAgentLoop, type AgentEvent } from '@/lib/agent-loop'
import { AGENT_MAX_TOOL_STEPS } from '@/lib/ai/guardrails'
import type { SupabaseClient } from '@supabase/supabase-js'

const toolContext = { supabase: {} as SupabaseClient, userId: 'u1' }
const target = { provider: 'openrouter', apiKey: 'k', model: 'm', effort: null } as never

function textResponse(content: string, tokens = 5): Response {
  return new Response(
    JSON.stringify({
      choices: [{ finish_reason: 'stop', message: { role: 'assistant', content } }],
      usage: { total_tokens: tokens },
    }),
    { status: 200 }
  )
}

function toolResponse(calls: Array<{ id: string; name: string; args: string }>, tokens = 5): Response {
  return new Response(
    JSON.stringify({
      choices: [
        {
          finish_reason: 'tool_calls',
          message: {
            role: 'assistant',
            content: null,
            tool_calls: calls.map((call) => ({
              id: call.id,
              type: 'function',
              function: { name: call.name, arguments: call.args },
            })),
          },
        },
      ],
      usage: { total_tokens: tokens },
    }),
    { status: 200 }
  )
}

function bodyOf(fetchMock: ReturnType<typeof vi.fn>, index: number): Record<string, unknown> {
  const call = fetchMock.mock.calls[index] as unknown as [string, RequestInit]
  return JSON.parse(call[1].body as string)
}

async function run(message: string, model = 'm') {
  const events: AgentEvent[] = []
  const result = await runAgentLoop(message, [], toolContext, (event) => events.push(event), {
    ...(target as object),
    model,
  } as never)
  return { events, result }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('runAgentLoop native function calling', () => {
  it('answers directly with a single request when the model calls no tool', async () => {
    const fetchMock = vi.fn(async () => textResponse('hello there'))
    vi.stubGlobal('fetch', fetchMock)

    const { events, result } = await run('hi')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const body = bodyOf(fetchMock, 0)
    expect(Array.isArray(body.tools)).toBe(true)
    expect(body.tool_choice).toBe('auto')
    expect(result.success).toBe(true)
    expect(events.some((e) => e.type === 'tool_start' || e.type === 'tool_done')).toBe(false)
    expect(events[events.length - 1].type).toBe('done')
  })

  it('runs requested tools, emits events and feeds the result back', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(toolResponse([{ id: 'call_1', name: 'get_pnl_stats', args: '{"period":"30d"}' }], 7))
      .mockResolvedValueOnce(textResponse('your pnl is fine', 3))
    vi.stubGlobal('fetch', fetchMock)

    const { events, result } = await run('how is my pnl')

    expect(fetchMock).toHaveBeenCalledTimes(2)
    const messages = bodyOf(fetchMock, 1).messages as Array<Record<string, unknown>>
    const toolMessage = messages.find((m) => m.role === 'tool')
    expect(toolMessage?.tool_call_id).toBe('call_1')
    expect(String(toolMessage?.content)).toContain('tool_data')
    const assistant = messages.find((m) => m.role === 'assistant')
    expect(assistant?.tool_calls).toBeDefined()
    const types = events.map((e) => e.type)
    expect(types).toContain('tool_start')
    expect(types).toContain('tool_done')
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.content).toBe('your pnl is fine')
      expect(result.data.tokensUsed).toBe(10)
    }
  })

  it('returns errors to the model for invalid JSON and unknown tools without throwing', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        toolResponse([
          { id: 'a', name: 'get_pnl_stats', args: '{not json' },
          { id: 'b', name: 'drop_database', args: '{}' },
          { id: 'c', name: 'get_trade_history', args: '{}' },
        ])
      )
      .mockResolvedValueOnce(textResponse('done'))
    vi.stubGlobal('fetch', fetchMock)

    const tradeTool = await import('@/lib/tools/trade-tool')
    vi.mocked(tradeTool.getTradeHistoryTool).mockRejectedValueOnce(new Error('db down'))

    const { events, result } = await run('x')

    expect(result.success).toBe(true)
    const messages = bodyOf(fetchMock, 1).messages as Array<Record<string, unknown>>
    const toolMessages = messages.filter((m) => m.role === 'tool')
    expect(toolMessages.map((m) => m.tool_call_id)).toEqual(['a', 'b', 'c'])
    expect(String(toolMessages[0].content)).toContain('Invalid tool arguments')
    expect(String(toolMessages[1].content)).toContain('Unknown tool')
    expect(String(toolMessages[2].content)).toContain('unavailable')
    expect(events.filter((e) => e.payload.tool === 'drop_database').length).toBe(0)
  })

  it('stops after the max steps and forces a text answer with tool_choice none', async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string)
      if (body.tool_choice === 'none') return textResponse('final text')
      return toolResponse([{ id: 'loop', name: 'get_pnl_stats', args: '{}' }])
    })
    vi.stubGlobal('fetch', fetchMock)

    const { result } = await run('keep going')

    expect(fetchMock).toHaveBeenCalledTimes(AGENT_MAX_TOOL_STEPS + 1)
    expect(bodyOf(fetchMock as never, AGENT_MAX_TOOL_STEPS).tool_choice).toBe('none')
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.content).toBe('final text')
  })

  it('uses the context fallback without tools for models with supportsTools false', async () => {
    const fetchMock = vi.fn(async () => textResponse('answer'))
    vi.stubGlobal('fetch', fetchMock)

    const { events, result } = await run('how is my pnl', 'no-tools')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const body = bodyOf(fetchMock, 0)
    expect(body.tools).toBeUndefined()
    expect(body.tool_choice).toBeUndefined()
    expect(result.success).toBe(true)
    expect(events.filter((e) => e.type === 'tool_start').length).toBe(2)
    expect(events.filter((e) => e.type === 'tool_done').length).toBe(2)
  })
})
