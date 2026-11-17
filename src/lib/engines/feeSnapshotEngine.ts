import type { FeeDailyPoint, PnlSnapshotFees } from '@/lib/types'
import { PNL_PERIODS } from '@/lib/types'
import { FEE_DAILY_SERIES_DAYS, FEE_USD_PRECISION } from '@/lib/config/fees'
import { buildFeeSummary, convertFeeToUsd, isFeeTradeType, sumFeeRows } from '@/lib/engines/feeEngine'
import { getPeriodStartDate, getWindowStartDate, isExecutedTrade, tradeVolumeUsd, type TradeWithExchange } from '@/lib/engines/snapshotBase'
import { APP_UTC_OFFSET_MINUTES, toDayKey } from '@/lib/time/dayBoundary'

export function buildFeeDailySeries(trades: TradeWithExchange[], now: Date): FeeDailyPoint[] {
  const startMs = getWindowStartDate(FEE_DAILY_SERIES_DAYS, now).getTime()
  const buckets = new Map<string, FeeDailyPoint>()

  for (const trade of trades) {
    if (!trade.exchange || !isFeeTradeType(trade.trade_type)) continue
    if (!isExecutedTrade(trade)) continue

    const tradedAt = new Date(trade.traded_at)
    if (tradedAt.getTime() < startMs) continue

    const date = toDayKey(tradedAt, APP_UTC_OFFSET_MINUTES)
    if (!date) continue

    const key = `${date}:${trade.exchange}:${trade.trade_type}`
    const point = buckets.get(key) ?? {
      date,
      exchange: trade.exchange,
      tradeType: trade.trade_type,
      feeUsd: 0,
      volumeUsd: 0,
    }

    point.feeUsd += convertFeeToUsd(trade) ?? 0
    point.volumeUsd += tradeVolumeUsd(trade)
    buckets.set(key, point)
  }

  return Array.from(buckets.values())
    .map((point) => ({
      ...point,
      feeUsd: parseFloat(point.feeUsd.toFixed(FEE_USD_PRECISION)),
      volumeUsd: parseFloat(point.volumeUsd.toFixed(FEE_USD_PRECISION)),
    }))
    .sort((a, b) => a.date.localeCompare(b.date) || a.exchange.localeCompare(b.exchange) || a.tradeType.localeCompare(b.tradeType))
}

export function buildPnlSnapshotFees(trades: TradeWithExchange[], now: Date): PnlSnapshotFees {
  const periods = {} as PnlSnapshotFees['periods']
  const totals = {} as PnlSnapshotFees['totals']

  for (const period of PNL_PERIODS) {
    const startMs = getPeriodStartDate(period, now).getTime()
    const inPeriod = trades.filter((trade) => new Date(trade.traded_at).getTime() >= startMs)
    const summary = buildFeeSummary(inPeriod)
    const sum = sumFeeRows(summary.rows)
    periods[period] = summary
    totals[period] = {
      feeUsd: parseFloat(sum.feeUsd.toFixed(FEE_USD_PRECISION)),
      volumeUsd: parseFloat(sum.volumeUsd.toFixed(FEE_USD_PRECISION)),
      tradeCount: sum.tradeCount,
    }
  }

  return { periods, totals, daily: buildFeeDailySeries(trades, now) }
}
