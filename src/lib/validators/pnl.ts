import { z } from 'zod'
import { decodeTradeCursor } from '@/lib/pagination/tradeCursor'
import { EXCHANGES, PERIOD_TYPES, SNAPSHOT_EXCHANGES, TRADE_SEGMENTS } from '@/lib/types'

export const PNLSummaryQuerySchema = z.object({
  range: z.enum(PERIOD_TYPES).default('all'),
  exchangeAccountId: z.string().uuid().optional(),
  exchange: z.enum(EXCHANGES).optional(),
  segment: z.enum(TRADE_SEGMENTS).default('all'),
})

export const PNLChartQuerySchema = z.object({
  range: z.enum(['day', 'week', 'month', 'year'] as const),
  exchangeAccountId: z.string().uuid().optional(),
  exchange: z.enum(EXCHANGES).optional(),
  segment: z.enum(TRADE_SEGMENTS).default('all'),
})

export const PNLCalendarQuerySchema = z.object({
  view: z.enum(['daily', 'monthly']).default('daily'),
  year: z.coerce.number().int().min(2020).max(2030),
  month: z.coerce.number().int().min(1).max(12).optional(),
  exchange: z.enum(EXCHANGES).optional(),
  segment: z.enum(TRADE_SEGMENTS).default('all'),
})

export const TradesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z
    .string()
    .max(512)
    .refine((value) => decodeTradeCursor(value) !== null)
    .optional(),
  exchangeAccountId: z.string().uuid().optional(),
  exchange: z.enum(EXCHANGES).optional(),
  symbol: z.string().optional(),
  segment: z.enum(TRADE_SEGMENTS).default('all'),
})

export const PNLOverviewQuerySchema = z.object({
  exchange: z.enum(EXCHANGES).optional(),
  segment: z.enum(TRADE_SEGMENTS).default('all'),
})

export const AssetDistributionQuerySchema = z.object({
  exchange: z.enum(EXCHANGES).optional(),
  segment: z.enum(TRADE_SEGMENTS).default('all'),
})

export const PnlSnapshotQuerySchema = z.object({
  exchange: z.enum(SNAPSHOT_EXCHANGES).default('all'),
  segment: z.enum(TRADE_SEGMENTS).default('all'),
})

export type PNLSummaryQuery = z.infer<typeof PNLSummaryQuerySchema>
export type PNLChartQuery = z.infer<typeof PNLChartQuerySchema>
export type PNLCalendarQuery = z.infer<typeof PNLCalendarQuerySchema>
export type TradesQuery = z.infer<typeof TradesQuerySchema>
export type PNLOverviewQuery = z.infer<typeof PNLOverviewQuerySchema>
export type PnlSnapshotQuery = z.infer<typeof PnlSnapshotQuerySchema>
export type AssetDistributionQuery = z.infer<typeof AssetDistributionQuerySchema>

export const FeeSummaryQuerySchema = z.object({
  exchange: z.enum(EXCHANGES).optional(),
  segment: z.enum(TRADE_SEGMENTS).default('all'),
})

export type FeeSummaryQuery = z.infer<typeof FeeSummaryQuerySchema>
