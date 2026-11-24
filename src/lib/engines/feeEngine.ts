import type { Exchange, FeeBreakdownRow, FeeSummary, FeeTradeType } from '@/lib/types'
import { FEE_TRADE_TYPES, FEE_USD_PRECISION, USD_LIKE_CURRENCIES } from '@/lib/config/fees'
import {
  extractBaseAssetFromSymbol,
  extractQuoteAssetFromSymbol,
  isExecutedTrade,
  isUsdLikeAsset,
  tradeVolumeUsd,
  type TradeWithExchange,
} from '@/lib/engines/snapshotBase'

const USD_LIKE = new Set<string>(USD_LIKE_CURRENCIES)

export type FeeFilter = { exchange: 'all' | Exchange; tradeType: 'all' | FeeTradeType }

export function isFeeTradeType(value: string): value is FeeTradeType {
  return (FEE_TRADE_TYPES as readonly string[]).includes(value)
}

export function convertFeeToUsd(trade: TradeWithExchange): number | null {
  const fee = Math.abs(Number(trade.fee))
  if (!Number.isFinite(fee)) return null
  if (fee === 0) return 0

  const currency = trade.fee_currency?.trim().toUpperCase()
  if (!currency || USD_LIKE.has(currency)) return fee

  const baseAsset = extractBaseAssetFromSymbol(trade.symbol)
  const quoteAsset = extractQuoteAssetFromSymbol(trade.symbol)
  if (quoteAsset !== null && !isUsdLikeAsset(quoteAsset)) {
    if (currency === quoteAsset && isUsdLikeAsset(baseAsset) && trade.price > 0) return fee / trade.price
    if (currency === baseAsset && isUsdLikeAsset(baseAsset)) return fee
    return null
  }
  if (baseAsset && currency === baseAsset && trade.price > 0) return fee * trade.price

  return null
}

export function buildFeeSummary(trades: TradeWithExchange[]): FeeSummary {
  const buckets = new Map<string, FeeBreakdownRow>()
  let unconvertedCount = 0

  for (const trade of trades) {
    if (!trade.exchange || !isFeeTradeType(trade.trade_type)) continue
    if (!isExecutedTrade(trade)) continue

    const key = `${trade.exchange}:${trade.trade_type}`
    const bucket = buckets.get(key) ?? {
      exchange: trade.exchange,
      tradeType: trade.trade_type,
      feeUsd: 0,
      volumeUsd: 0,
      tradeCount: 0,
    }

    const feeUsd = convertFeeToUsd(trade)
    if (feeUsd === null) {
      unconvertedCount += 1
    } else {
      bucket.feeUsd += feeUsd
    }
    bucket.volumeUsd += tradeVolumeUsd(trade)
    bucket.tradeCount += 1
    buckets.set(key, bucket)
  }

  const rows = Array.from(buckets.values())
    .map((row) => ({
      ...row,
      feeUsd: parseFloat(row.feeUsd.toFixed(FEE_USD_PRECISION)),
      volumeUsd: parseFloat(row.volumeUsd.toFixed(FEE_USD_PRECISION)),
    }))
    .sort((a, b) => b.volumeUsd - a.volumeUsd)

  return { rows, unconvertedCount }
}

export function filterFeeRows(rows: FeeBreakdownRow[], filter: FeeFilter): FeeBreakdownRow[] {
  return rows.filter(
    (row) =>
      (filter.exchange === 'all' || row.exchange === filter.exchange) &&
      (filter.tradeType === 'all' || row.tradeType === filter.tradeType)
  )
}

export function sumFeeRows(rows: FeeBreakdownRow[]): { feeUsd: number; volumeUsd: number; tradeCount: number } {
  return rows.reduce(
    (acc, row) => ({
      feeUsd: acc.feeUsd + row.feeUsd,
      volumeUsd: acc.volumeUsd + row.volumeUsd,
      tradeCount: acc.tradeCount + row.tradeCount,
    }),
    { feeUsd: 0, volumeUsd: 0, tradeCount: 0 }
  )
}
