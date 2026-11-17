import { FEE_RING_COLORS, type FeeRing } from '@/lib/config/fees'
import { EXCHANGES, type Exchange, type FeeBreakdownRow } from '@/lib/types'

export type ExchangeFeeTotals = {
  exchange: Exchange
  feeUsd: number
  volumeUsd: number
  tradeCount: number
}

export function summarizeByExchange(rows: FeeBreakdownRow[]): ExchangeFeeTotals[] {
  return EXCHANGES.map((exchange) =>
    rows
      .filter((row) => row.exchange === exchange)
      .reduce<ExchangeFeeTotals>(
        (acc, row) => ({
          exchange,
          feeUsd: acc.feeUsd + row.feeUsd,
          volumeUsd: acc.volumeUsd + row.volumeUsd,
          tradeCount: acc.tradeCount + row.tradeCount,
        }),
        { exchange, feeUsd: 0, volumeUsd: 0, tradeCount: 0 }
      )
  )
}

export function shareOf(value: number, total: number): number {
  return total > 0 ? value / total : 0
}

export function getFeeColor(ring: FeeRing, exchange: Exchange): string {
  const palette = FEE_RING_COLORS[ring]
  return palette[EXCHANGES.indexOf(exchange) % palette.length]
}
