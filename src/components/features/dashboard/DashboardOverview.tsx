'use client'

import dynamic from 'next/dynamic'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { FeeOverview } from '@/components/features/dashboard/FeeOverview'
import { usePnlJobWatcher } from '@/components/features/dashboard/usePnlJobWatcher'
import { MarketTicker } from '@/components/features/dashboard/MarketTicker'
import { PNLCalendar } from '@/components/features/dashboard/PNLCalendar'
import { RecentTradesTable } from '@/components/features/dashboard/RecentTradesTable'
import { PeriodSwitch } from '@/components/features/dashboard/PeriodSwitch'
import { StatCard } from '@/components/features/dashboard/StatCard'
import { ExchangeLogo } from '@/components/ui/ExchangeLogo'
import { EXCHANGE_BRANDING } from '@/lib/exchangeBranding'
import { PanelSkeleton } from '@/components/ui/PanelSkeleton'
import { useT } from '@/lib/i18n/client'
import { fillTemplate } from '@/lib/i18n/format'
import { latestAvailableAt } from '@/lib/cooldown/cooldown'
import { useCooldown } from '@/lib/hooks/useCooldown'
import { isJobActive } from '@/lib/pnl/jobState'
import { PNL_JOB_STALE_ERROR } from '@/lib/pnl/snapshotLimits'
import { FEE_PERIOD_DEFAULT } from '@/lib/config/fees'
import {
  EXCHANGES,
  type DashboardOverview as DashboardOverviewData,
  type Exchange,
  type PnlJob,
  type PnlPeriod,
  type PnlSnapshotRecord,
  type TradeSegment,
} from '@/lib/types'

type ExchangeFilter = 'all' | Exchange

const VIETNAM_TIME_ZONE = 'Asia/Ho_Chi_Minh'

const SEGMENT_OPTIONS: { key: 'all' | 'spot' | 'future'; value: TradeSegment }[] = [
  { key: 'all', value: 'all' },
  { key: 'spot', value: 'spot' },
  { key: 'future', value: 'futures' },
]

const EXCHANGE_OPTIONS: ExchangeFilter[] = ['all', ...EXCHANGES]
const EXCHANGE_LOGO_SIZE = 16
const DEFAULT_CARD_PERIOD = FEE_PERIOD_DEFAULT as PnlPeriod

function pickVolume(totals: DashboardOverviewData['totalTrades'], period: PnlPeriod): number | undefined {
  const byPeriod: Record<PnlPeriod, number | undefined> = {
    today: totals.volumeUsdToday,
    d7: totals.volumeUsdD7,
    d30: totals.volumeUsdD30,
    d90: totals.volumeUsdD90,
    year: totals.volumeUsdYear,
  }
  return byPeriod[period]
}

function formatPnl(value: number, intlLocale: string): string {
  const abs = Math.abs(value).toLocaleString(intlLocale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })

  if (value > 0) return `+$${abs}`
  if (value < 0) return `-$${abs}`
  return '$0.00'
}

function formatVolume(value: number, intlLocale: string): string {
  return value.toLocaleString(intlLocale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

function formatPercent(value: number): string {
  return `${value.toFixed(2)}%`
}

function formatVietnamTime(iso: string, intlLocale: string): string {
  return new Date(iso).toLocaleString(intlLocale, {
    timeZone: VIETNAM_TIME_ZONE,
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

const PNLChart = dynamic(
  () => import('@/components/features/dashboard/PNLChart').then((m) => m.PNLChart),
  { ssr: false, loading: () => <PanelSkeleton heightClassName="h-[22rem] sm:h-[24rem]" /> }
)

export function DashboardOverview(): React.JSX.Element {
  const { t, intlLocale } = useT()
  const d = t.dashboard
  const [segment, setSegment] = useState<TradeSegment>('all')
  const [exchangeFilter, setExchangeFilter] = useState<ExchangeFilter>('all')
  const [snapshot, setSnapshot] = useState<PnlSnapshotRecord | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadFailed, setLoadFailed] = useState(false)
  const [job, setJob] = useState<PnlJob | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [calculateError, setCalculateError] = useState<string | null>(null)
  const [reloadToken, setReloadToken] = useState(0)
  const [tickerReady, setTickerReady] = useState(false)
  const [feePeriod, setFeePeriod] = useState<PnlPeriod>(DEFAULT_CARD_PERIOD)
  const [volumePeriod, setVolumePeriod] = useState<PnlPeriod>(DEFAULT_CARD_PERIOD)

  const [availableAt, setAvailableAt] = useState<string | null>(null)
  const [retryAt, setRetryAt] = useState<string | null>(null)
  const cooldown = useCooldown(latestAvailableAt(availableAt, retryAt))

  const jobActive = job !== null && isJobActive(job)
  const calculating = submitting || jobActive

  const errorMessage = useCallback(
    (code: string): string => {
      const messages = d.calculateErrors as Record<string, string>
      return messages[code] ?? d.calculateErrors.FALLBACK
    },
    [d.calculateErrors]
  )

  useEffect(() => {
    const params = new URLSearchParams({ segment, exchange: exchangeFilter })
    const controller = new AbortController()
    setLoading(true)
    setLoadFailed(false)

    fetch(`/api/pnl/snapshot?${params.toString()}`, { signal: controller.signal })
      .then(async (response) => response.json())
      .then((payload) => {
        if (payload.success) {
          setSnapshot((payload.data.snapshot as PnlSnapshotRecord | null) ?? null)
          setJob((payload.data.job as PnlJob | null) ?? null)
          setAvailableAt((payload.data.calculateAvailableAt as string | null) ?? null)
          return
        }
        setSnapshot(null)
        setLoadFailed(true)
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') {
          return
        }
        setSnapshot(null)
        setLoadFailed(true)
      })
      .finally(() => {
        if (controller.signal.aborted) return
        setLoading(false)
        setTickerReady(true)
      })

    return () => controller.abort()
  }, [segment, exchangeFilter, reloadToken])

  const watchedJobId = job && jobActive ? job.id : null

  usePnlJobWatcher(
    watchedJobId,
    useMemo(
      () => ({
        onUpdate: setJob,
        onCompleted: () => {
          setReloadToken((token) => token + 1)
        },
        onFailed: (failed) => {
          setCalculateError(errorMessage(failed.error ?? ''))
        },
        onTimeout: () => {
          setJob(null)
          setCalculateError(errorMessage(PNL_JOB_STALE_ERROR))
        },
        onMissing: () => setJob(null),
      }),
      [errorMessage]
    )
  )

  const handleCalculate = useCallback(async (): Promise<void> => {
    setSubmitting(true)
    setCalculateError(null)

    try {
      const response = await fetch('/api/pnl/calculate', { method: 'POST' })
      const payload = await response.json()
      if (payload.success) {
        setJob(payload.data.job as PnlJob)
        return
      }
      if (typeof payload.retryAt === 'string') {
        setRetryAt(payload.retryAt)
        return
      }
      setCalculateError(errorMessage(String(payload.error ?? '')))
    } catch {
      setCalculateError(d.calculateErrors.FALLBACK)
    } finally {
      setSubmitting(false)
    }
  }, [d.calculateErrors.FALLBACK, errorMessage])

  const statusText = job && (job.status === 'queued' || job.status === 'running') ? d.jobStatus[job.status] : null

  const overview = snapshot?.payload.overview ?? null
  const fees = snapshot?.payload.fees ?? null
  const feeTotal = fees?.totals?.[feePeriod]?.feeUsd
  const periodVolume = overview ? pickVolume(overview.totalTrades, volumePeriod) : undefined
  const missing = d.missingValue

  return (
    <div className="h-full overflow-y-auto overflow-x-hidden p-4 sm:p-6 lg:p-8 space-y-6 sm:space-y-8 bg-slate-50 dark:bg-background-dark/50">
      <div className="flex flex-col gap-5">
        {tickerReady && <MarketTicker />}
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div className="min-w-0">
            <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-slate-900 dark:text-slate-100">{d.title}</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400">{d.subtitle}</p>
          </div>
          <div className="flex w-full min-w-0 flex-col gap-2 xl:w-auto xl:items-end">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between xl:justify-end">
              <p className="text-xs text-slate-500 dark:text-slate-400" aria-live="polite">
                {snapshot
                  ? fillTemplate(d.lastCalculated, {
                      time: formatVietnamTime(snapshot.calculatedAt, intlLocale),
                    })
                  : d.neverCalculated}
              </p>
              <button
                type="button"
                onClick={handleCalculate}
                disabled={calculating || cooldown.active}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-bold text-accent transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <span className={`material-symbols-outlined text-lg ${calculating ? 'animate-spin' : ''}`}>
                  {calculating ? 'progress_activity' : 'calculate'}
                </span>
                {calculating
                  ? d.calculating
                  : cooldown.active
                    ? fillTemplate(d.calculateAvailableIn, { time: cooldown.label })
                    : d.calculate}
              </button>
            </div>
            {statusText && (
              <p className="text-xs font-medium text-slate-500 dark:text-slate-400" aria-live="polite">
                {statusText}
              </p>
            )}
            {calculateError && (
              <p role="alert" className="text-xs font-medium text-rose-500">
                {calculateError}
              </p>
            )}
            <div className="w-full overflow-x-auto">
              <div className="inline-flex min-w-full items-center gap-2 rounded-xl border border-slate-200 dark:border-primary/20 bg-white dark:bg-background-dark p-1">
                {SEGMENT_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    onClick={() => setSegment(option.value)}
                    className={`flex-1 px-3 sm:px-4 h-9 rounded-lg text-xs sm:text-sm font-bold transition-colors shrink-0 ${
                      segment === option.value
                        ? 'bg-primary text-accent'
                        : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-primary/10'
                    }`}
                  >
                    {d.segments[option.key]}
                  </button>
                ))}
              </div>
            </div>

            <div className="w-full overflow-x-auto">
              <div className="inline-flex min-w-full items-center gap-2 rounded-xl border border-slate-200 dark:border-primary/20 bg-white dark:bg-background-dark p-1">
                {EXCHANGE_OPTIONS.map((option) => (
                  <button
                    key={option}
                    onClick={() => setExchangeFilter(option)}
                    className={`flex flex-1 basis-0 min-w-[5.5rem] items-center justify-center gap-1.5 px-2 h-8 rounded-lg text-xs font-bold whitespace-nowrap transition-colors shrink-0 ${
                      exchangeFilter === option
                        ? 'bg-primary text-accent'
                        : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-primary/10'
                    }`}
                  >
                    {option === 'all' ? (
                      d.allExchanges
                    ) : (
                      <>
                        <ExchangeLogo exchange={option} size={EXCHANGE_LOGO_SIZE} />
                        <span className="truncate">{EXCHANGE_BRANDING[option].name}</span>
                      </>
                    )}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {loading && !snapshot && (
        <div className="flex min-h-[240px] items-center justify-center rounded-xl border border-slate-200 dark:border-primary/20 bg-background-light dark:bg-background-dark">
          <span className="material-symbols-outlined animate-spin text-primary/40 text-3xl">refresh</span>
        </div>
      )}

      {!loading && !snapshot && (
        <div className="flex min-h-[240px] flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-slate-300 dark:border-primary/30 bg-background-light dark:bg-background-dark p-6 text-center">
          <span className="material-symbols-outlined text-5xl text-slate-300 dark:text-slate-600">
            {loadFailed ? 'error' : 'calculate'}
          </span>
          <p className="text-base font-bold text-slate-900 dark:text-slate-100">
            {loadFailed ? d.loadError : d.emptyTitle}
          </p>
          {!loadFailed && (
            <p className="max-w-md text-sm text-slate-500 dark:text-slate-400">{d.emptyBody}</p>
          )}
        </div>
      )}

      {snapshot && overview && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 sm:gap-6">
            <StatCard
              title={d.cards.pnlToday}
              value={formatPnl(overview.pnl.today, intlLocale)}
              changePositive={overview.pnl.today >= 0}
              icon="today"
              valueHighlight={overview.pnl.today !== 0}
            />
            <StatCard
              title={d.cards.pnl7d}
              value={formatPnl(overview.pnl.d7, intlLocale)}
              changePositive={overview.pnl.d7 >= 0}
              icon="date_range"
              valueHighlight={overview.pnl.d7 !== 0}
            />
            <StatCard
              title={d.cards.pnl30d}
              value={formatPnl(overview.pnl.d30, intlLocale)}
              changePositive={overview.pnl.d30 >= 0}
              icon="calendar_month"
              valueHighlight={overview.pnl.d30 !== 0}
            />
            <StatCard
              title={d.cards.pnl90d}
              value={formatPnl(overview.pnl.d90, intlLocale)}
              changePositive={overview.pnl.d90 >= 0}
              icon="event_upcoming"
              valueHighlight={overview.pnl.d90 !== 0}
            />
            <StatCard
              title={d.cards.pnl1y}
              value={formatPnl(overview.pnl.year, intlLocale)}
              changePositive={overview.pnl.year >= 0}
              icon="calendar_today"
              valueHighlight={overview.pnl.year !== 0}
            />
            <StatCard
              title={d.cards.totalFee}
              value={feeTotal === undefined ? missing : `$${formatVolume(feeTotal, intlLocale)}`}
              note={feeTotal === undefined ? d.cards.feeMissingHint : undefined}
              icon="payments"
              control={<PeriodSwitch value={feePeriod} onChange={setFeePeriod} />}
            />
            <StatCard
              title={d.cards.winRate}
              value={formatPercent(overview.winRate.d7)}
              progressBar={overview.winRate.d7}
              note={`${d.periods.d30}: ${formatPercent(overview.winRate.d30)}\n${d.periods.d90}: ${formatPercent(overview.winRate.d90)}\n${d.periods.all}: ${formatPercent(overview.winRate.all)}`}
              icon="target"
            />
            <StatCard
              title={d.cards.totalTrades}
              value={`${overview.totalTrades.count}`}
              note={[
                periodVolume === undefined
                  ? `${d.periodSwitch.full[volumePeriod]}: ${missing}`
                  : fillTemplate(d.volumePeriodLine, {
                      period: d.periodSwitch.full[volumePeriod],
                      value: formatVolume(periodVolume, intlLocale),
                    }),
                fillTemplate(d.volumeAllLine, { value: formatVolume(overview.totalTrades.volumeUsdAll ?? 0, intlLocale) }),
              ].join('\n')}
              control={<PeriodSwitch value={volumePeriod} onChange={setVolumePeriod} />}
              icon="receipt_long"
            />
          </div>

          <PNLChart chart={snapshot.payload.chart} />

          <PNLCalendar calendar={snapshot.payload.calendar} />

          <FeeOverview fees={fees} calculatedAt={snapshot.calculatedAt} />

          <RecentTradesTable
            segment={segment}
            exchange={exchangeFilter}
            onExchangeChange={setExchangeFilter}
          />
        </>
      )}
    </div>
  )
}
