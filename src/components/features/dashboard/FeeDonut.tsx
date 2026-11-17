'use client'

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts'
import { getFeeColor, shareOf, type ExchangeFeeTotals } from '@/components/features/dashboard/feeRingData'
import { useT } from '@/lib/i18n/client'
import { fillTemplate } from '@/lib/i18n/format'
import { EXCHANGE_BRANDING } from '@/lib/exchangeBranding'
import {
  FEE_CHART_HEIGHT,
  FEE_PERCENT_DECIMALS,
  FEE_RING_CHART_MARGIN,
  FEE_RING_COLORS,
  FEE_RING_DIM_OPACITY,
  FEE_RING_MIN_ANGLE,
  FEE_RING_PADDING_ANGLE,
  FEE_RING_RADII,
  FEE_RINGS,
  FEE_TOOLTIP_Z_INDEX,
  FULL_CIRCLE_DEGREES,
  PERCENT_SCALE,
  type FeeRing,
} from '@/lib/config/fees'
import type { Exchange } from '@/lib/types'

const START_ANGLE = 90

type RingDatum = {
  key: string
  exchange: Exchange
  ring: FeeRing
  value: number
}

type FeeDonutProps = {
  rows: ExchangeFeeTotals[]
  focus: FeeRing | null
  onFocusChange: (ring: FeeRing | null) => void
  centerLabel: string
  centerValue: string
  formatUsd: (value: number) => string
}

export function FeeDonut({
  rows,
  focus,
  onFocusChange,
  centerLabel,
  centerValue,
  formatUsd,
}: FeeDonutProps): React.JSX.Element {
  const { t, intlLocale } = useT()
  const f = t.dashboard.fees

  const ringData = (ring: FeeRing): RingDatum[] =>
    rows
      .map((row) => ({
        key: `${ring}-${row.exchange}`,
        exchange: row.exchange,
        ring,
        value: ring === 'fee' ? row.feeUsd : row.volumeUsd,
      }))
      .filter((datum) => datum.value > 0)

  const ringTotal = (ring: FeeRing): number => ringData(ring).reduce((sum, datum) => sum + datum.value, 0)

  const ringLabel = (ring: FeeRing): string => (ring === 'fee' ? f.fee : f.volume)

  const toggle = (ring: FeeRing): void => onFocusChange(focus === ring ? null : ring)

  const formatShare = (value: number): string =>
    (value * PERCENT_SCALE).toLocaleString(intlLocale, {
      minimumFractionDigits: FEE_PERCENT_DECIMALS,
      maximumFractionDigits: FEE_PERCENT_DECIMALS,
    })

  const opacityFor = (ring: FeeRing): number => (focus && focus !== ring ? FEE_RING_DIM_OPACITY : 1)

  return (
    <div>
      <div
        className="relative [&_.recharts-sector]:cursor-pointer [&_.recharts-sector]:outline-none [&_.recharts-sector]:transition-opacity"
        style={{ height: FEE_CHART_HEIGHT }}
        role="img"
        aria-label={f.chartLabel}
      >
        <ResponsiveContainer width="100%" height="100%">
          <PieChart margin={FEE_RING_CHART_MARGIN}>
            {FEE_RINGS.map((ring) => (
              <Pie
                key={ring}
                data={ringData(ring)}
                dataKey="value"
                nameKey="key"
                innerRadius={FEE_RING_RADII[ring].inner}
                outerRadius={FEE_RING_RADII[ring].outer}
                startAngle={START_ANGLE}
                endAngle={START_ANGLE - FULL_CIRCLE_DEGREES}
                minAngle={FEE_RING_MIN_ANGLE}
                paddingAngle={FEE_RING_PADDING_ANGLE}
                isAnimationActive={false}
                onClick={() => toggle(ring)}
              >
                {ringData(ring).map((datum) => (
                  <Cell
                    key={datum.key}
                    fill={getFeeColor(ring, datum.exchange)}
                    fillOpacity={opacityFor(ring)}
                    strokeWidth={0}
                  />
                ))}
              </Pie>
            ))}
            <Tooltip
              wrapperStyle={{ zIndex: FEE_TOOLTIP_Z_INDEX }}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null
                const datum = payload[0].payload as RingDatum
                const total = ringTotal(datum.ring)
                return (
                  <div className="rounded-lg border border-slate-200 dark:border-primary/30 bg-white dark:bg-background-dark px-3 py-2 shadow-md">
                    <p className="flex items-center gap-2 text-xs font-bold text-slate-900 dark:text-slate-100">
                      <span
                        className="inline-block size-2.5 rounded-sm"
                        style={{ backgroundColor: getFeeColor(datum.ring, datum.exchange) }}
                      />
                      {EXCHANGE_BRANDING[datum.exchange].name}
                      <span className="font-medium text-slate-500">{ringLabel(datum.ring)}</span>
                    </p>
                    <p className="mt-1 text-sm font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100">
                      ${formatUsd(datum.value)}
                    </p>
                    <p className="text-[11px] font-mono tabular-nums text-slate-500">
                      {fillTemplate(f.tooltipShare, {
                        value: formatShare(shareOf(datum.value, total)),
                        ring: ringLabel(datum.ring),
                      })}
                    </p>
                  </div>
                )
              }}
            />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
          <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">{centerLabel}</p>
          <p className="text-xl font-black font-mono tabular-nums text-slate-900 dark:text-slate-100">{centerValue}</p>
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center justify-center gap-2" role="group" aria-label={f.ringHint}>
        {FEE_RINGS.map((ring) => (
          <button
            key={ring}
            type="button"
            aria-pressed={focus === ring}
            aria-label={fillTemplate(f.ringToggle, { ring: ringLabel(ring) })}
            onClick={() => toggle(ring)}
            className={`inline-flex h-8 items-center gap-2 rounded-full border px-3 text-xs font-bold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${
              focus === ring
                ? 'border-primary bg-primary text-accent'
                : 'border-slate-200 dark:border-primary/20 bg-white dark:bg-background-dark text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-primary/10'
            }`}
          >
            <span
              className="inline-block size-2.5 rounded-full"
              style={{ backgroundColor: FEE_RING_COLORS[ring][0] }}
            />
            {ringLabel(ring)}
          </button>
        ))}
      </div>
      <p className="mt-2 text-center text-[11px] text-slate-500">{f.ringHint}</p>
    </div>
  )
}
