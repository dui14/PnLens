import { z } from 'zod'
import {
  DEMO_MAX_LEVERAGE,
  DEMO_MAX_SIZE_INPUT,
  DEMO_MIN_LEVERAGE,
  DEMO_SIZE_MODES,
  DEMO_SYMBOLS,
} from '@/lib/config/demoTrading'

export const PlaceDemoOrderSchema = z
  .object({
    symbol: z
      .string()
      .toUpperCase()
      .refine((value) => DEMO_SYMBOLS.includes(value)),
    side: z.enum(['buy', 'sell']),
    orderType: z.enum(['market', 'limit']),
    leverage: z.number().int().min(DEMO_MIN_LEVERAGE).max(DEMO_MAX_LEVERAGE),
    marginMode: z.enum(['cross', 'isolated']),
    sizeMode: z.enum(DEMO_SIZE_MODES),
    size: z.number().positive().max(DEMO_MAX_SIZE_INPUT),
    price: z.number().positive().max(DEMO_MAX_SIZE_INPUT).nullable().optional(),
    takeProfit: z.number().positive().nullable().optional(),
    stopLoss: z.number().positive().nullable().optional(),
  })
  .refine((data) => data.orderType !== 'limit' || (data.price != null && data.price > 0), {
    message: 'Limit orders require a price',
  })

const closeFields = {
  closeQuantity: z.number().positive().optional(),
  orderType: z.enum(['market', 'limit']).default('market'),
  price: z.number().positive().max(DEMO_MAX_SIZE_INPUT).nullable().optional(),
}

const requireClosePrice = (data: { orderType: string; price?: number | null }): boolean =>
  data.orderType !== 'limit' || (data.price != null && data.price > 0)

export const CloseDemoOrderSchema = z
  .object({ tradeId: z.string().uuid(), ...closeFields })
  .refine(requireClosePrice, { message: 'Limit close requires a price' })

export const CloseDemoOrderBodySchema = z
  .object(closeFields)
  .refine(requireClosePrice, { message: 'Limit close requires a price' })

export const UpdateDemoOrderSchema = z
  .object({
    takeProfit: z.number().positive().nullable().optional(),
    stopLoss: z.number().positive().nullable().optional(),
    price: z.number().positive().max(DEMO_MAX_SIZE_INPUT).optional(),
  })
  .refine((data) => data.takeProfit !== undefined || data.stopLoss !== undefined || data.price !== undefined, {
    message: 'Nothing to update',
  })

export const DemoTradeIdParamSchema = z.object({
  id: z.string().uuid(),
})

export const DemoOrdersQuerySchema = z.object({
  status: z.enum(['pending', 'open', 'closed', 'cancelled']).optional(),
})

export type PlaceDemoOrderInput = z.infer<typeof PlaceDemoOrderSchema>
export type UpdateDemoOrderInput = z.infer<typeof UpdateDemoOrderSchema>
export type CloseDemoOrderInput = z.infer<typeof CloseDemoOrderSchema>
export type DemoOrdersQuery = z.infer<typeof DemoOrdersQuerySchema>
