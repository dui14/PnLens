'use client'

import { useMemo, useState } from 'react'
import {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { useT } from '@/lib/i18n/client'
import type { ChartRange, PNLChartPoint } from '@/lib/types'

const CHART_RANGES: { key: 'week' | 'month' | 'year'; value: ChartRange }[] = [
  { key: 'week', value: 'week' },
  { key: 'month', value: 'month' },
  { key: 'year', value: 'year' },
]

type ChartDatum = {
  date: string
  pnl: number
  cumulative_pnl: number
}

const COLOR_POSITIVE = '#10b981'
const COLOR_NEGATIVE = '#f43f5e'
const COLOR_NEUTRAL = '#64748b'

function signColor(value: number): string {
  if (value > 0) return COLOR_POSITIVE
  if (value < 0) return COLOR_NEGATIVE
  return COLOR_NEUTRAL
}

function formatSigned(value: number, intlLocale: string): string {
  const sign = value > 0 ? '+' : value < 0 ? '-' : ''
  return `${sign}$${formatCurrency(Math.abs(value), intlLocale)}`
}

type TooltipProps = {
  active?: boolean
  payload?: { payload: ChartDatum }[]
  range: string
  intlLocale: string
  periodLabel: string
  cumulativeLabel: string
}

function ChartTooltip({ active, payload, range, intlLocale, periodLabel, cumulativeLabel }: TooltipProps): React.JSX.Element | null {
  const datum = payload?.[0]?.payload
  if (!active || !datum) return null
  return (
    <div className="rounded-[10px] border border-slate-300 bg-slate-50/95 px-3 py-2 text-xs text-slate-900 shadow-sm">
      <p className="mb-1 font-semibold">{formatDateTick(datum.date, range, intlLocale)}</p>
      <p className="flex justify-between gap-4">
        <span>{periodLabel}</span>
        <span className="font-mono font-bold" style={{ color: signColor(datum.pnl) }}>{formatSigned(datum.pnl, intlLocale)}</span>
      </p>
      <p className="flex justify-between gap-4">
        <span>{cumulativeLabel}</span>
        <span className="font-mono font-bold" style={{ color: signColor(datum.cumulative_pnl) }}>{formatSigned(datum.cumulative_pnl, intlLocale)}</span>
      </p>
    </div>
  )
}

function formatCurrency(value: number, intlLocale: string): string {
  return value.toLocaleString(intlLocale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

function formatDateTick(value: string, range: string, intlLocale: string): string {
  if (range === 'year') {
    const [year, month] = value.split('-')
    const date = new Date(`${year}-${month}-01T00:00:00+07:00`)
    return date.toLocaleDateString(intlLocale, { timeZone: 'Asia/Ho_Chi_Minh', month: 'short' })
  }

  const date = new Date(`${value}T00:00:00+07:00`)
  return date.toLocaleDateString(intlLocale, { timeZone: 'Asia/Ho_Chi_Minh', month: 'short', day: 'numeric' })
}

function getYDomain(data: ChartDatum[]): [number, number] {
  if (data.length === 0) return [-1, 1]

  const maxAbs = Math.max(
    ...data.map((point) => Math.max(Math.abs(point.cumulative_pnl), Math.abs(point.pnl))),
    1
  )

  return [-maxAbs, maxAbs]
}

type PNLChartProps = {
  chart: Record<ChartRange, PNLChartPoint[]>
}

export function PNLChart({ chart }: PNLChartProps): React.JSX.Element {
  const { t, intlLocale } = useT()
  const c = t.chart
  const [range, setRange] = useState<ChartRange>('month')
  const points: ChartDatum[] = useMemo(() => chart[range] ?? [], [chart, range])

  const hasData = points.length > 0
  const yDomain = getYDomain(points)

  return (
    <div className="bg-background-light dark:bg-background-dark p-4 sm:p-6 rounded-xl border border-slate-200 dark:border-primary/20 shadow-sm">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-6">
        <div>
          <h2 className="text-lg font-bold">{c.title}</h2>
          <p className="text-sm text-slate-500">{c.subtitle}</p>
        </div>
        <div className="overflow-x-auto">
          <div className="inline-flex gap-2">
            {CHART_RANGES.map((r) => (
              <button
                key={r.value}
                onClick={() => setRange(r.value)}
                className={`px-3 py-1 rounded-lg text-xs font-bold transition-colors shrink-0 ${
                  range === r.value
                    ? 'bg-primary/10 text-primary border border-primary/20'
                    : 'hover:bg-slate-100 dark:hover:bg-primary/5 text-slate-400'
                }`}
              >
                {c.ranges[r.key]}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="relative h-56 sm:h-64 w-full">
        {!hasData && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
            <span className="material-symbols-outlined text-slate-300 dark:text-slate-600 text-4xl">show_chart</span>
            <p className="text-sm text-slate-400">{c.empty}</p>
          </div>
        )}
        {hasData && (
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart
              data={points}
              margin={{ top: 12, right: 12, left: 0, bottom: 12 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#cbd5e1" opacity={0.35} />
              <XAxis
                dataKey="date"
                tick={{ fill: '#64748b', fontSize: 11 }}
                tickFormatter={(value) => formatDateTick(String(value), range, intlLocale)}
                interval="preserveStartEnd"
                minTickGap={24}
                axisLine={{ stroke: '#cbd5e1', opacity: 0.5 }}
                tickLine={false}
                label={{ value: c.timeAxis, position: 'insideBottomRight', offset: -6, fill: '#64748b', fontSize: 11 }}
              />
              <YAxis
                tick={{ fill: '#64748b', fontSize: 11 }}
                axisLine={{ stroke: '#cbd5e1', opacity: 0.5 }}
                tickLine={false}
                domain={yDomain}
                width={64}
                tickFormatter={(value) => `${Number(value) < 0 ? '-' : ''}$${Math.abs(Number(value)).toFixed(0)}`}
              />
              <Tooltip
                cursor={{ fill: '#94a3b8', fillOpacity: 0.12 }}
                content={
                  <ChartTooltip
                    range={range}
                    intlLocale={intlLocale}
                    periodLabel={range === 'year' ? c.periodPnl.monthly : c.periodPnl.daily}
                    cumulativeLabel={c.tooltipLabel}
                  />
                }
              />
              <ReferenceLine y={0} stroke="#0f172a" strokeOpacity={0.4} strokeDasharray="6 4" />
              <Bar dataKey="pnl" maxBarSize={24} isAnimationActive={false}>
                {points.map((point) => (
                  <Cell key={point.date} fill={signColor(point.pnl)} fillOpacity={0.55} />
                ))}
              </Bar>
              <Line
                dataKey="cumulative_pnl"
                type="monotone"
                stroke="#0f766e"
                strokeWidth={3}
                dot={false}
                activeDot={{ r: 4, fill: '#0f766e' }}
              />
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  )
}
