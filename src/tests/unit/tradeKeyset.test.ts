import { describe, expect, it } from 'vitest'
import { decodeTradeCursor, encodeTradeCursor, keysetFilter } from '@/lib/pagination/tradeCursor'
import { TradesQuerySchema } from '@/lib/validators/pnl'
import { fetchTradesForPNL, getTradeTotals, getTrades } from '@/lib/db/tradesDb'
import type { SupabaseClient } from '@supabase/supabase-js'

const CURSOR = { tradedAt: '2026-01-01T00:00:00.123456+00:00', id: '0b0c4f5e-1a2b-4c3d-8e9f-0a1b2c3d4e5f' }
const BATCH = 1000

type Call = { method: string; args: unknown[] }

function fakeClient(pages: Record<string, unknown>[][]) {
  const queries: Call[][] = []
  const client = {
    from() {
      const calls: Call[] = []
      queries.push(calls)
      const result = () => {
        const data = pages[queries.length - 1] ?? []
        return Promise.resolve({ data, error: null, count: data.length })
      }
      const builder: Record<string, unknown> = {}
      for (const method of ['select', 'eq', 'order', 'limit', 'or', 'gt', 'gte', 'lte', 'ilike']) {
        builder[method] = (...args: unknown[]) => {
          calls.push({ method, args })
          return builder
        }
      }
      builder.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
        result().then(resolve, reject)
      return builder
    },
  }
  return { client: client as unknown as SupabaseClient, queries }
}

function row(index: number): Record<string, unknown> {
  return {
    id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    traded_at: `2026-01-01T00:00:${String(index % 60).padStart(2, '0')}.000000+00:00`,
    quantity: 1,
    price: 1,
    fee: 0,
    realized_pnl: null,
  }
}

describe('trade cursor', () => {
  it('round-trips', () => {
    expect(decodeTradeCursor(encodeTradeCursor(CURSOR))).toEqual(CURSOR)
  })

  it('rejects malformed input', () => {
    expect(decodeTradeCursor('not-a-cursor')).toBeNull()
    expect(decodeTradeCursor(Buffer.from('{"tradedAt":"x","id":"y"}').toString('base64url'))).toBeNull()
  })

  it('builds quoted keyset filters per direction', () => {
    expect(keysetFilter(CURSOR, 'asc')).toBe(
      `traded_at.gt."${CURSOR.tradedAt}",and(traded_at.eq."${CURSOR.tradedAt}",id.gt.${CURSOR.id})`
    )
    expect(keysetFilter(CURSOR, 'desc')).toContain('traded_at.lt.')
  })
})

describe('TradesQuerySchema cursor', () => {
  it('accepts a valid cursor and rejects an invalid one', () => {
    expect(TradesQuerySchema.safeParse({ cursor: encodeTradeCursor(CURSOR) }).success).toBe(true)
    expect(TradesQuerySchema.safeParse({ cursor: 'garbage' }).success).toBe(false)
    expect(TradesQuerySchema.safeParse({}).success).toBe(true)
  })
})

describe('keyset batching', () => {
  it('fetchTradesForPNL advances by the last row instead of an offset', async () => {
    const full = Array.from({ length: BATCH }, (_, i) => row(i))
    const { client, queries } = fakeClient([full, [row(BATCH)]])
    const result = await fetchTradesForPNL(client, 'u1', {})
    expect(result.success && result.data.length).toBe(BATCH + 1)
    expect(queries).toHaveLength(2)
    expect(queries[0].some((c) => c.method === 'or')).toBe(false)
    const last = full[BATCH - 1]
    const or = queries[1].find((c) => c.method === 'or')
    expect(or?.args[0]).toBe(
      keysetFilter({ tradedAt: String(last.traded_at), id: String(last.id) }, 'asc')
    )
  })

  it('getTrades returns nextCursor only when more rows exist', async () => {
    const { client } = fakeClient([[row(1), row(2), row(3)]])
    const page = await getTrades(client, 'u1', { limit: 2 })
    expect(page.trades).toHaveLength(2)
    expect(decodeTradeCursor(page.nextCursor ?? '')?.id).toBe(row(2).id)

    const end = fakeClient([[row(1)]])
    const last = await getTrades(end.client, 'u1', { limit: 2 })
    expect(last.nextCursor).toBeNull()
  })

  it('getTrades applies a desc keyset filter for a cursor', async () => {
    const { client, queries } = fakeClient([[]])
    await getTrades(client, 'u1', { limit: 5, cursor: CURSOR })
    expect(queries[0].find((c) => c.method === 'or')?.args[0]).toBe(keysetFilter(CURSOR, 'desc'))
  })

  it('getTradeTotals pages by id', async () => {
    const full = Array.from({ length: BATCH }, (_, i) => row(i))
    const { client, queries } = fakeClient([full, [row(BATCH)]])
    const totals = await getTradeTotals(client, 'u1', {})
    expect(totals.count).toBe(BATCH)
    expect(queries[1].find((c) => c.method === 'gt' && c.args[0] === 'id')?.args[1]).toBe(full[BATCH - 1].id)
  })
})
