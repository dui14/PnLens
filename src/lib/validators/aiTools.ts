import { z } from 'zod'
import { TOOL_EXCHANGES, TOOL_PERIODS } from '@/lib/tools/definitions'
import {
  TOOL_NEWS_LIMIT_MAX,
  TOOL_NEWS_LIMIT_MIN,
  TOOL_QUERY_MAX_LENGTH,
  TOOL_SYMBOLS_LIST_MAX_LENGTH,
  TOOL_SYMBOL_MAX_LENGTH,
  TOOL_TRADE_LIMIT_MAX,
  TOOL_TRADE_LIMIT_MIN,
  TRADE_SYMBOL_PATTERN,
} from '@/lib/ai/guardrails'

function boundedText(maxLength: number) {
  return z
    .string()
    .transform((value) => value.trim().slice(0, maxLength))
    .transform((value) => (value.length > 0 ? value : undefined))
    .optional()
    .catch(undefined)
}

function clampedInt(min: number, max: number) {
  return z.coerce
    .number()
    .finite()
    .transform((value) => Math.max(min, Math.min(max, Math.trunc(value))))
    .optional()
    .catch(undefined)
}

const exchangeField = z.enum(TOOL_EXCHANGES).optional().catch(undefined)

const symbolField = z
  .string()
  .transform((value) => value.trim().toUpperCase())
  .refine((value) => value.length > 0 && value.length <= TOOL_SYMBOL_MAX_LENGTH)
  .refine((value) => TRADE_SYMBOL_PATTERN.test(value))
  .optional()
  .catch(undefined)

export const TradeHistoryArgsSchema = z.object({
  exchange: exchangeField,
  symbol: symbolField,
  limit: clampedInt(TOOL_TRADE_LIMIT_MIN, TOOL_TRADE_LIMIT_MAX),
})

export const PnlStatsArgsSchema = z.object({
  period: z.enum(TOOL_PERIODS).optional().catch(undefined),
  exchange: exchangeField,
})

export const NewsArgsSchema = z.object({
  query: boundedText(TOOL_QUERY_MAX_LENGTH),
  limit: clampedInt(TOOL_NEWS_LIMIT_MIN, TOOL_NEWS_LIMIT_MAX),
})

export const MarketArgsSchema = z.object({
  symbols: boundedText(TOOL_SYMBOLS_LIST_MAX_LENGTH),
  query: boundedText(TOOL_QUERY_MAX_LENGTH),
})
