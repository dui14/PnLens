'use client'

import dynamic from 'next/dynamic'
import { useMemo, useState } from 'react'
import { FeeCompareToolbar } from '@/components/features/dashboard/FeeCompareToolbar'
import { PeriodSwitch } from '@/components/features/dashboard/PeriodSwitch'
import { buildCompareData, endDateFromIso, type CompareConfig } from '@/components/features/dashboard/feeCompareData'
import { getFeeColor, shareOf, summarizeByExchange } from '@/components/features/dashboard/feeRingData'
import { ExchangeLogo } from '@/components/ui/ExchangeLogo'
import { PanelSkeleton } from '@/components/ui/PanelSkeleton'
import { filterFeeRows, sumFeeRows } from '@/lib/engines/feeEngine'
import { EXCHANGE_BRANDING } from '@/lib/exchangeBranding'
import { useT } from '@/lib/i18n/client'
import { fillTemplate } from '@/lib/i18n/format'
import { COMPARE_CHART_MODES, type CompareChartMode } from '@/lib/config/feeCompare'
import {
  FEE_PERCENT_DECIMALS,
  FEE_TRADE_TYPES,
  FEE_PERIOD_DEFAULT,
  FEE_RATE_DECIMALS,
  FEE_SMALL_USD_DECIMALS,
  FEE_SMALL_USD_THRESHOLD,
  FEE_USD_DECIMALS,
  PERCENT_SCALE,
  type FeeRing,
} from '@/lib/config/fees'
import { EXCHANGES, type PnlPeriod, type PnlSnapshotFees } from '@/lib/types'

const FeeDonut = dynamic(() => import('@/components/features/dashboard/FeeDonut').then((m) => m.FeeDonut), {
  ssr: false,
  loading: () => <PanelSkeleton heightClassName="h-[21rem]" />,
})

const FeeCompareChart = dynamic(
  () => import('@/components/features/dashboard/FeeCompareChart').then((m) => m.FeeCompareChart),
  { ssr: false, loading: () => <PanelSkeleton heightClassName="h-[22rem]" /> }
)

const EXCHANGE_LOGO_SIZE = 16
const DEFAULT_PERIOD = FEE_PERIOD_DEFAULT as PnlPeriod

type FeeOverviewProps = {
  fees: PnlSnapshotFees | null | undefined
  calculatedAt: string
}

type View = 'donut' | 'compare'

const EMPTY_CONFIG: CompareConfig = {
  exchanges: [...EXCHANGES],
  types: [...FEE_TRADE_TYPES],
  metrics: [],
  period: DEFAULT_PERIOD,
}

const HEADER_BUTTON =
  'inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 dark:border-primary/20 bg-white dark:bg-background-dark px-3 text-sm font-bold text-slate-700 dark:text-slate-200 transition-colors hover:bg-slate-100 dark:hover:bg-primary/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary'

export function FeeOverview({ fees, calculatedAt }: FeeOverviewProps): React.JSX.Element {
  const { t, intlLocale } = useT()
  const f = t.dashboard.fees
  const c = f.compare
  const [period, setPeriod] = useState<PnlPeriod>(DEFAULT_PERIOD)
  const [focus, setFocus] = useState<FeeRing | null>(null)
  const [view, setView] = useState<View>('donut')
  const [toolbarOpen, setToolbarOpen] = useState(false)
  const [config, setConfig] = useState<CompareConfig | null>(null)
  const [chartMode, setChartMode] = useState<CompareChartMode>(COMPARE_CHART_MODES[0])

  const summary = fees?.periods[period] ?? null
  const rows = useMemo(() => summary?.rows ?? [], [summary])
  const totals = useMemo(() => sumFeeRows(rows), [rows])
  const spotTotals = useMemo(() => sumFeeRows(filterFeeRows(rows, { exchange: 'all', tradeType: 'spot' })), [rows])
  const futuresTotals = useMemo(() => sumFeeRows(filterFeeRows(rows, { exchange: 'all', tradeType: 'futures' })), [rows])
  const perExchange = useMemo(() => summarizeByExchange(rows), [rows])
  const endDate = useMemo(() => endDateFromIso(calculatedAt), [calculatedAt])
  const compareData = useMemo(
    () => (config && endDate && fees ? buildCompareData(fees.daily, config, endDate) : null),
    [config, endDate, fees]
  )

  const formatUsd = (value: number): string => {
    const decimals = Math.abs(value) < FEE_SMALL_USD_THRESHOLD && value !== 0 ? FEE_SMALL_USD_DECIMALS : FEE_USD_DECIMALS
    return value.toLocaleString(intlLocale, { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
  }

  const formatPercent = (ratio: number, decimals: number): string =>
    `${(ratio * PERCENT_SCALE).toLocaleString(intlLocale, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    })}%`

  const hasData = totals.volumeUsd > 0
  const centerLabel = focus === 'volume' ? f.volume : focus === 'fee' ? f.fee : f.centerLabel
  const centerValue =
    focus === 'volume'
      ? `$${formatUsd(totals.volumeUsd)}`
      : focus === 'fee'
        ? `$${formatUsd(totals.feeUsd)}`
        : formatPercent(shareOf(totals.feeUsd, totals.volumeUsd), FEE_PERCENT_DECIMALS)

  const openToolbar = (): void => setToolbarOpen(true)

  const handleConfirm = (next: CompareConfig): void => {
    setConfig(next)
    setView('compare')
    setToolbarOpen(false)
  }

  const handleCancel = (): void => setToolbarOpen(false)

  const handleBack = (): void => {
    setView('donut')
    setToolbarOpen(false)
  }

  return (
    <div className="bg-background-light dark:bg-background-dark rounded-xl border border-slate-200 dark:border-primary/20 shadow-sm overflow-hidden">
      <div className="flex flex-col gap-3 p-4 sm:p-6 border-b border-slate-200 dark:border-primary/20 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <h2 className="text-lg font-bold">{f.title}</h2>
          <p className="text-sm text-slate-500">{f.subtitle}</p>
        </div>
        {fees && (
          <div className="flex flex-wrap items-center gap-2">
            {view === 'donut' ? (
              <>
                {!toolbarOpen && <PeriodSwitch value={period} onChange={setPeriod} variant="full" />}
                <button type="button" onClick={openToolbar} aria-expanded={toolbarOpen} className={HEADER_BUTTON}>
                  <span className="material-symbols-outlined text-lg">compare_arrows</span>
                  {c.open}
                </button>
              </>
            ) : (
              <>
                <div role="group" aria-label={c.chartMode} className="inline-flex items-center gap-0.5 rounded-lg border border-slate-200 dark:border-primary/20 bg-white dark:bg-background-dark p-0.5">
                  {COMPARE_CHART_MODES.map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      aria-pressed={chartMode === mode}
                      onClick={() => setChartMode(mode)}
                      className={`inline-flex h-8 items-center gap-1 rounded-md px-3 text-xs font-bold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary ${
                        chartMode === mode
                          ? 'bg-primary text-accent'
                          : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-primary/10'
                      }`}
                    >
                      <span className="material-symbols-outlined text-base">{mode === 'line' ? 'show_chart' : 'bar_chart'}</span>
                      {mode === 'line' ? c.line : c.bar}
                    </button>
                  ))}
                </div>
                <button type="button" onClick={openToolbar} aria-expanded={toolbarOpen} className={HEADER_BUTTON}>
                  <span className="material-symbols-outlined text-lg">tune</span>
                  {c.config}
                </button>
                <button type="button" onClick={handleBack} className={HEADER_BUTTON}>
                  <span className="material-symbols-outlined text-lg">arrow_back</span>
                  {c.back}
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {fees && toolbarOpen && (
        <FeeCompareToolbar
          daily={fees.daily}
          endDate={endDate}
          initial={config ?? { ...EMPTY_CONFIG, period }}
          onConfirm={handleConfirm}
          onCancel={handleCancel}
        />
      )}

      {!fees && (
        <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
          <span className="material-symbols-outlined text-slate-300 dark:text-slate-600 text-5xl">payments</span>
          <p className="text-sm text-slate-500 max-w-[320px] leading-relaxed">{f.missing}</p>
        </div>
      )}

      {fees && view === 'compare' && compareData && (
        <div className="p-4 sm:p-6">
          <FeeCompareChart data={compareData} mode={chartMode} formatUsd={formatUsd} />
        </div>
      )}

      {fees && view === 'donut' && !hasData && (
        <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
          <span className="material-symbols-outlined text-slate-300 dark:text-slate-600 text-5xl">payments</span>
          <p className="text-sm text-slate-500 max-w-[280px] leading-relaxed">{f.empty}</p>
        </div>
      )}

      {fees && view === 'donut' && hasData && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 p-4 sm:p-6">
          <div className="min-w-0 space-y-5">
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-slate-500">{f.totalPaid}</p>
              <p className="mt-1 text-3xl font-black font-mono tabular-nums text-red-600 dark:text-red-400">${formatUsd(totals.feeUsd)}</p>
              <p className="mt-1 text-xs text-slate-500">
                {f.volume}: <span className="font-mono tabular-nums font-bold text-emerald-700 dark:text-emerald-400">${formatUsd(totals.volumeUsd)}</span>
                {' · '}
                {f.feeShare}: <span className="font-mono tabular-nums font-bold">{formatPercent(shareOf(totals.feeUsd, totals.volumeUsd), FEE_RATE_DECIMALS)}</span>
              </p>
            </div>

            <dl className="grid grid-cols-2 gap-3">
              {[
                { key: 'spot', label: f.spot, value: spotTotals.feeUsd, count: spotTotals.tradeCount },
                { key: 'futures', label: f.futures, value: futuresTotals.feeUsd, count: futuresTotals.tradeCount },
              ].map((item) => (
                <div key={item.key} className="rounded-lg border border-slate-200 dark:border-primary/15 p-3">
                  <dt className="text-[11px] font-bold uppercase tracking-wider text-slate-500">{item.label}</dt>
                  <dd className="mt-1 text-lg font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100">
                    ${formatUsd(item.value)}
                  </dd>
                  <dd className="text-[11px] text-slate-500">{fillTemplate(f.trades, { count: item.count })}</dd>
                </div>
              ))}
            </dl>

            <div>
              <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-2">{f.byExchange}</p>
              <ul className="divide-y divide-slate-200 dark:divide-primary/15">
                {perExchange.map((item) => (
                  <li key={item.exchange} className="py-2.5">
                    <div className="flex items-center justify-between gap-3">
                      <span className="inline-flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-slate-100 min-w-0">
                        <ExchangeLogo exchange={item.exchange} size={EXCHANGE_LOGO_SIZE} className="rounded-sm" />
                        <span className="truncate">{EXCHANGE_BRANDING[item.exchange].name}</span>
                      </span>
                      <span className="text-[11px] font-mono tabular-nums text-slate-500">
                        {item.tradeCount > 0
                          ? formatPercent(shareOf(item.feeUsd, item.volumeUsd), FEE_RATE_DECIMALS)
                          : f.noData}
                      </span>
                    </div>
                    <div className="mt-1.5 grid grid-cols-2 gap-3">
                      {(['volume', 'fee'] as const).map((ring) => {
                        const value = ring === 'fee' ? item.feeUsd : item.volumeUsd
                        const total = ring === 'fee' ? totals.feeUsd : totals.volumeUsd
                        return (
                          <div
                            key={ring}
                            className={`min-w-0 transition-opacity ${focus && focus !== ring ? 'opacity-40' : item.tradeCount === 0 ? 'opacity-60' : ''}`}
                          >
                            <p className="flex items-center gap-1.5 text-[11px] text-slate-500">
                              <span
                                className="inline-block size-2.5 shrink-0 rounded-sm"
                                style={{ backgroundColor: getFeeColor(ring, item.exchange) }}
                              />
                              {ring === 'fee' ? f.fee : f.volume}
                            </p>
                            <p className="text-sm font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100 truncate">
                              ${formatUsd(value)}
                              <span className="ml-1.5 text-[11px] font-medium text-slate-500">
                                {formatPercent(shareOf(value, total), 1)}
                              </span>
                            </p>
                          </div>
                        )
                      })}
                    </div>
                  </li>
                ))}
              </ul>
            </div>

            {summary && summary.unconvertedCount > 0 && (
              <p className="text-[11px] text-slate-500">{fillTemplate(f.unconverted, { count: summary.unconvertedCount })}</p>
            )}
          </div>

          <div className="min-w-0">
            <FeeDonut
              rows={perExchange}
              focus={focus}
              onFocusChange={setFocus}
              centerLabel={centerLabel}
              centerValue={centerValue}
              formatUsd={formatUsd}
            />
          </div>
        </div>
      )}
    </div>
  )
}
