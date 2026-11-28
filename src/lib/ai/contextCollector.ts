import { TOOL_NAMES, type ToolName } from '@/lib/tools/definitions'
import { getCryptoNewsTool } from '@/lib/tools/news-tool'
import { getMarketQuotesTool } from '@/lib/tools/market-tool'
import { getPnlStatsTool, getTradeHistoryTool, type TradeToolContext } from '@/lib/tools/trade-tool'
import { ZodError } from 'zod'
import {
  MarketArgsSchema,
  NewsArgsSchema,
  PnlStatsArgsSchema,
  TradeHistoryArgsSchema,
} from '@/lib/validators/aiTools'
import { TOOL_TRADE_LIMIT_DEFAULT, wrapToolResult } from '@/lib/ai/guardrails'

export const CONTEXT_TRADE_ROWS_MAX = TOOL_TRADE_LIMIT_DEFAULT
export const CONTEXT_PAYLOAD_MAX_CHARS = 12000
export const CONTEXT_UNAVAILABLE_NOTE = 'Data unavailable right now; do not guess numbers for it.'
export const CONTEXT_UNKNOWN_TOOL_NOTE = 'Unknown tool; no data was fetched.'
export const CONTEXT_INVALID_ARGS_NOTE = 'Invalid tool arguments; fix them or answer without this tool.'
export const CONTEXT_INSTRUCTION =
  'Context collected from the user\'s PnLens data and public sources for this turn. Use only this data for figures. If a block is unavailable, say so briefly instead of inventing numbers.'

export const NEWS_KEYWORDS = [
  'news',
  'headline',
  'sentiment',
  'market today',
  'crypto market',
  'what happened',
  'tin tức',
  'tin tuc',
  'thị trường',
  'thi truong',
  'bản tin',
  'ban tin',
] as const

export const MARKET_KEYWORDS = [
  'price',
  'quote',
  'gold',
  'xauusd',
  'stock',
  'index',
  'forex',
  'nasdaq',
  'nvda',
  'spx',
  'dxy',
  'eurusd',
  'giá',
  'gia ',
  'vàng',
  'vang',
  'cổ phiếu',
  'co phieu',
  'chỉ số',
  'chi so',
  'ngoại hối',
  'ngoai hoi',
] as const

export const PERFORMANCE_KEYWORDS = [
  'pnl',
  'profit',
  'loss',
  'win rate',
  'winrate',
  'performance',
  'my trades',
  'trade history',
  'fees',
  'how am i doing',
  'how i am doing',
  'lãi',
  'lỗ',
  'hiệu suất',
  'hieu suat',
  'lịch sử',
  'lich su',
  'giao dịch của tôi',
  'giao dich cua toi',
  'phí',
] as const

export type ContextToolPlan = {
  tool: ToolName
  args: Record<string, unknown>
}

export type ContextToolOutcome = {
  plan: ContextToolPlan
  result: Record<string, unknown> | null
  payload: string
}

function includesAny(text: string, keywords: readonly string[]): boolean {
  return keywords.some((keyword) => text.includes(keyword))
}

export function planContextTools(userMessage: string): ContextToolPlan[] {
  const text = userMessage.toLowerCase()
  const plans: ContextToolPlan[] = []

  if (includesAny(text, PERFORMANCE_KEYWORDS)) {
    plans.push(
      { tool: 'get_pnl_stats', args: {} },
      { tool: 'get_trade_history', args: { limit: CONTEXT_TRADE_ROWS_MAX } }
    )
  }

  if (includesAny(text, MARKET_KEYWORDS)) {
    plans.push({ tool: 'get_market_quotes', args: { query: userMessage } })
  }
  if (includesAny(text, NEWS_KEYWORDS)) {
    plans.push({ tool: 'get_crypto_news', args: {} })
  }

  return plans
}

async function runPlan(
  context: TradeToolContext,
  plan: ContextToolPlan
): Promise<Record<string, unknown>> {
  if (plan.tool === 'get_trade_history') {
    return getTradeHistoryTool(context, TradeHistoryArgsSchema.parse(plan.args))
  }
  if (plan.tool === 'get_pnl_stats') {
    return getPnlStatsTool(context, PnlStatsArgsSchema.parse(plan.args))
  }
  if (plan.tool === 'get_market_quotes') {
    return getMarketQuotesTool(MarketArgsSchema.parse(plan.args))
  }
  return getCryptoNewsTool(NewsArgsSchema.parse(plan.args))
}

function boundPayload(payload: string): string {
  return payload.length > CONTEXT_PAYLOAD_MAX_CHARS
    ? `${payload.slice(0, CONTEXT_PAYLOAD_MAX_CHARS)}...[truncated]`
    : payload
}

export type ToolCallOutcome = {
  tool: ToolName | null
  args: Record<string, unknown>
  result: Record<string, unknown> | null
  payload: string
}

function isToolName(name: string): name is ToolName {
  return (TOOL_NAMES as readonly string[]).includes(name)
}

function parseToolArguments(raw: string): Record<string, unknown> | null {
  if (!raw.trim()) return {}
  try {
    const parsed: unknown = JSON.parse(raw)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
    return null
  } catch {
    return null
  }
}

export async function executeToolCall(
  context: TradeToolContext,
  name: string,
  rawArguments: string
): Promise<ToolCallOutcome> {
  if (!isToolName(name)) {
    return {
      tool: null,
      args: {},
      result: null,
      payload: wrapToolResult(name, { error: CONTEXT_UNKNOWN_TOOL_NOTE }),
    }
  }

  const args = parseToolArguments(rawArguments)
  if (!args) {
    return {
      tool: name,
      args: {},
      result: null,
      payload: wrapToolResult(name, { error: CONTEXT_INVALID_ARGS_NOTE }),
    }
  }

  try {
    const result = await runPlan(context, { tool: name, args })
    return { tool: name, args, result, payload: boundPayload(wrapToolResult(name, result)) }
  } catch (error) {
    const note = error instanceof ZodError ? CONTEXT_INVALID_ARGS_NOTE : CONTEXT_UNAVAILABLE_NOTE
    return {
      tool: name,
      args,
      result: null,
      payload: wrapToolResult(name, { unavailable: true, note }),
    }
  }
}

export async function collectContext(
  context: TradeToolContext,
  plans: ContextToolPlan[]
): Promise<ContextToolOutcome[]> {
  const settled = await Promise.allSettled(plans.map((plan) => runPlan(context, plan)))

  return settled.map((entry, index) => {
    const plan = plans[index]
    if (entry.status === 'fulfilled') {
      return {
        plan,
        result: entry.value,
        payload: boundPayload(wrapToolResult(plan.tool, entry.value)),
      }
    }
    return {
      plan,
      result: null,
      payload: wrapToolResult(plan.tool, { unavailable: true, note: CONTEXT_UNAVAILABLE_NOTE }),
    }
  })
}

export function buildContextMessage(outcomes: ContextToolOutcome[]): string {
  return `${CONTEXT_INSTRUCTION}\n\n${outcomes.map((outcome) => outcome.payload).join('\n\n')}`
}
