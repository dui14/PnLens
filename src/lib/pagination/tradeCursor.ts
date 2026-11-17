import { z } from 'zod'

export type TradeCursor = {
  tradedAt: string
  id: string
}

const TradeCursorSchema = z.object({
  tradedAt: z.string().min(1).refine((value) => !Number.isNaN(Date.parse(value))),
  id: z.string().uuid(),
})

export function encodeTradeCursor(cursor: TradeCursor): string {
  return Buffer.from(JSON.stringify({ tradedAt: cursor.tradedAt, id: cursor.id }), 'utf8').toString('base64url')
}

export function decodeTradeCursor(value: string): TradeCursor | null {
  try {
    const json = Buffer.from(value, 'base64url').toString('utf8')
    const parsed = TradeCursorSchema.safeParse(JSON.parse(json))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

export function keysetFilter(cursor: TradeCursor, direction: 'asc' | 'desc'): string {
  const op = direction === 'asc' ? 'gt' : 'lt'
  const at = `"${cursor.tradedAt}"`
  return `traded_at.${op}.${at},and(traded_at.eq.${at},id.${op}.${cursor.id})`
}
