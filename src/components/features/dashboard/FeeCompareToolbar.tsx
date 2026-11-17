'use client'

import { useMemo, useState } from 'react'
import { PeriodSwitch } from '@/components/features/dashboard/PeriodSwitch'
import { isCompareConfigValid, listExchangesWithData, type CompareConfig } from '@/components/features/dashboard/feeCompareData'
import { getExchangeTagClass } from '@/components/features/dashboard/tradeTags'
import { ExchangeLogo } from '@/components/ui/ExchangeLogo'
import { COMPARE_METRICS, COMPARE_MIN_TYPES, type CompareMetric } from '@/lib/config/feeCompare'
import { FEE_TRADE_TYPES } from '@/lib/config/fees'
import { EXCHANGE_BRANDING } from '@/lib/exchangeBranding'
import { useT } from '@/lib/i18n/client'
import { EXCHANGES, type Exchange, type FeeDailyPoint, type FeeTradeType } from '@/lib/types'

const EXCHANGE_LOGO_SIZE = 16

type FeeCompareToolbarProps = {
  daily: FeeDailyPoint[]
  endDate: string | null
  initial: CompareConfig
  onConfirm: (config: CompareConfig) => void
  onCancel: () => void
}

const CHIP_BASE =
  'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-xs font-bold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-40'
const CHIP_IDLE =
  'border-slate-200 dark:border-primary/20 bg-white dark:bg-background-dark text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-primary/10'
const CHIP_ACTIVE = 'border-primary bg-primary text-accent'

export function FeeCompareToolbar({ daily, endDate, initial, onConfirm, onCancel }: FeeCompareToolbarProps): React.JSX.Element {
  const { t } = useT()
  const f = t.dashboard.fees
  const c = f.compare
  const [exchanges, setExchanges] = useState<Exchange[]>(initial.exchanges)
  const [types, setTypes] = useState<FeeTradeType[]>(initial.types)
  const [metrics, setMetrics] = useState<CompareMetric[]>(initial.metrics)
  const [period, setPeriod] = useState(initial.period)

  const withData = useMemo(() => listExchangesWithData(daily, period, endDate), [daily, period, endDate])
  const draft: CompareConfig = { exchanges, types, metrics, period }
  const valid = isCompareConfigValid(draft)

  const typeLabel = (type: FeeTradeType): string => (type === 'spot' ? f.spot : f.futures)
  const metricLabel = (metric: CompareMetric): string => (metric === 'fee' ? f.fee : f.volume)

  const toggleExchange = (exchange: Exchange): void =>
    setExchanges((current) =>
      current.includes(exchange) ? current.filter((item) => item !== exchange) : [...current, exchange]
    )

  const typeOptions: FeeTradeType[][] = [...FEE_TRADE_TYPES.map((type) => [type]), [...FEE_TRADE_TYPES]]

  const typeOptionLabel = (option: FeeTradeType[]): string =>
    option.length === 1 ? typeLabel(option[0]) : c.typeBoth

  const isTypeOptionActive = (option: FeeTradeType[]): boolean =>
    option.length === types.length && option.every((type) => types.includes(type))

  const selectTypes = (option: FeeTradeType[]): void => {
    if (option.length >= COMPARE_MIN_TYPES) setTypes(option)
  }

  const toggleMetric = (metric: CompareMetric): void =>
    setMetrics((current) =>
      current.includes(metric) ? current.filter((item) => item !== metric) : [...current, metric]
    )

  const labelClass = 'w-20 shrink-0 text-[11px] font-bold uppercase tracking-wider text-slate-500'

  return (
    <div
      role="region"
      aria-label={c.toolbarLabel}
      className="space-y-3 border-b border-slate-200 dark:border-primary/20 bg-slate-50 dark:bg-primary/5 px-4 py-4 sm:px-6"
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <span className={labelClass}>{c.exchanges}</span>
        <div className="flex flex-wrap items-center gap-2">
          {EXCHANGES.map((exchange) => {
            const active = exchanges.includes(exchange)
            const hasData = withData.includes(exchange)
            return (
              <button
                key={exchange}
                type="button"
                aria-pressed={active}
                onClick={() => toggleExchange(exchange)}
                title={hasData ? undefined : c.exchangeNoData}
                className={`${CHIP_BASE} ${active ? getExchangeTagClass(exchange, true) : CHIP_IDLE} ${hasData ? '' : 'opacity-60'}`}
              >
                <ExchangeLogo exchange={exchange} size={EXCHANGE_LOGO_SIZE} className="rounded-sm" />
                {EXCHANGE_BRANDING[exchange].name}
                {!hasData && <span className="text-[10px] font-medium text-slate-500">{f.noData}</span>}
              </button>
            )
          })}
          <span className="text-[11px] text-slate-500">{c.exchangesHint}</span>
        </div>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <span className={labelClass}>{c.type}</span>
        <div className="flex flex-wrap items-center gap-2">
          {typeOptions.map((option) => (
            <button
              key={option.join('+')}
              type="button"
              aria-pressed={isTypeOptionActive(option)}
              onClick={() => selectTypes(option)}
              className={`${CHIP_BASE} ${isTypeOptionActive(option) ? CHIP_ACTIVE : CHIP_IDLE}`}
            >
              {typeOptionLabel(option)}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <span className={labelClass}>{c.metric}</span>
        <div className="flex flex-wrap items-center gap-2">
          {COMPARE_METRICS.map((metric) => (
            <button
              key={metric}
              type="button"
              aria-pressed={metrics.includes(metric)}
              onClick={() => toggleMetric(metric)}
              className={`${CHIP_BASE} ${metrics.includes(metric) ? CHIP_ACTIVE : CHIP_IDLE}`}
            >
              {metricLabel(metric)}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <span className={labelClass}>{c.period}</span>
        <PeriodSwitch value={period} onChange={setPeriod} variant="full" />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
        <p className="text-[11px] text-slate-500" aria-live="polite">
          {valid ? '' : c.incomplete}
        </p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="h-9 rounded-lg border border-slate-200 dark:border-primary/20 px-4 text-sm font-bold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-primary/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            {c.cancel}
          </button>
          <button
            type="button"
            disabled={!valid}
            onClick={() => onConfirm(draft)}
            className="h-9 rounded-lg bg-primary px-4 text-sm font-bold text-accent hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            {c.confirm}
          </button>
        </div>
      </div>
    </div>
  )
}
