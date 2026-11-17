import { describe, expect, it } from 'vitest'
import { fetchTradesForPNL } from '@/lib/db/tradesDb'

describe('fetchTradesForPNL columns', () => {
  it('selects fee_currency and funding_fee so fee conversion sees the currency', async () => {
    const selects: string[] = []
    const builder: Record<string, unknown> = {}
    const chain = () => builder
    for (const name of ['eq', 'order', 'limit', 'or', 'gte', 'lte', 'gt']) builder[name] = chain
    builder.select = (columns: string) => {
      selects.push(columns)
      return builder
    }
    builder.then = (resolve: (value: unknown) => void) =>
      resolve({
        data: [
          {
            id: 't1',
            symbol: 'USDTVND',
            quantity: '1',
            price: '26000',
            fee: '-2600',
            fee_currency: 'VND',
            funding_fee: '0',
            exchange_accounts: { exchange: 'bitget', is_active: true },
          },
        ],
        error: null,
      })
    const supabase = { from: () => builder } as never

    const result = await fetchTradesForPNL(supabase, 'user-1', {})

    expect(selects[0]).toContain('fee_currency')
    expect(selects[0]).toContain('funding_fee')
    expect(result.success && result.data[0]?.fee_currency).toBe('VND')
  })
})
