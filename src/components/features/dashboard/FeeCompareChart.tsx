'use client'

import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { CompareData, CompareSeries } from '@/components/features/dashboard/feeCompareData'
import { getFeeColor } from '@/components/features/dashboard/feeRingData'
import {
  COMPARE_ACTIVE_DOT_RADIUS,
  COMPARE_ALT_TYPE_OPACITY,
  COMPARE_AXIS_IDS,
  COMPARE_AXIS_WIDTH,
  COMPARE_BAR_MAX_SIZE,
  COMPARE_BAR_RADIUS,
  COMPARE_BAR_STROKE_WIDTH,
  COMPARE_CHART_HEIGHT,
  COMPARE_CHART_MARGIN,
  COMPARE_COMPACT_DECIMALS,
  COMPARE_CURSOR_FILL,
  COMPARE_CURSOR_STROKE,
  COMPARE_DASH,
  COMPARE_DOT_MAX_POINTS,
  COMPARE_DOT_RADIUS,
  COMPARE_GRID_COLOR,
  COMPARE_LINE_WIDTH,
  COMPARE_TICK_FONT_SIZE,
  COMPARE_TOOLTIP_Z_INDEX,
  type CompareChartMode,
  type CompareMetric,
} from '@/lib/config/feeCompare'
import { EXCHANGE_BRANDING } from '@/lib/exchangeBranding'
import { useT } from '@/lib/i18n/client'
import { fillTemplate } from '@/lib/i18n/format'
import type { FeeTradeType } from '@/lib/types'

type FeeCompareChartProps = {
  data: CompareData
  mode: CompareChartMode
  formatUsd: (value: number) => string
}

const AXIS_TICK_CLASS = '[&_.recharts-cartesian-axis-tick-value]:fill-slate-500 dark:[&_.recharts-cartesian-axis-tick-value]:fill-slate-400'

export function FeeCompareChart({ data, mode, formatUsd }: FeeCompareChartProps): React.JSX.Element {
  const { t, intlLocale } = useT()
  const f = t.dashboard.fees
  const c = f.compare
  const metrics = Array.from(new Set(data.series.map((item) => item.metric)))
  const dual = metrics.length > 1
  const showDots = data.rows.length <= COMPARE_DOT_MAX_POINTS

  const metricLabel = (metric: CompareMetric): string => (metric === 'fee' ? f.fee : f.volume)
  const typeLabel = (type: FeeTradeType): string => (type === 'spot' ? f.spot : f.futures)
  const colorOf = (series: CompareSeries): string => getFeeColor(series.metric, series.exchange)
  const nameOf = (series: CompareSeries): string =>
    fillTemplate(c.seriesName, {
      exchange: EXCHANGE_BRANDING[series.exchange].name,
      type: typeLabel(series.tradeType),
      metric: metricLabel(series.metric),
    })

  const axisOf = (metric: CompareMetric): string => (dual ? COMPARE_AXIS_IDS[metric] : COMPARE_AXIS_IDS.fee)

  const formatDate = (bucket: string): string =>
    new Date(`${bucket}T00:00:00Z`).toLocaleDateString(intlLocale, { timeZone: 'UTC', month: 'short', day: 'numeric' })

  const formatFullDate = (bucket: string): string => {
    const text = new Date(`${bucket}T00:00:00Z`).toLocaleDateString(intlLocale, {
      timeZone: 'UTC',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    })
    return data.bucketing === 'week' ? fillTemplate(c.weekOf, { date: text }) : text
  }

  const formatCompact = (value: number): string =>
    value.toLocaleString(intlLocale, {
      notation: 'compact',
      maximumFractionDigits: COMPARE_COMPACT_DECIMALS,
    })

  const axes = metrics.map((metric, index) => (
    <YAxis
      key={metric}
      yAxisId={axisOf(metric)}
      orientation={dual && index === 1 ? 'right' : 'left'}
      width={COMPARE_AXIS_WIDTH}
      tickFormatter={formatCompact}
      tick={{ fontSize: COMPARE_TICK_FONT_SIZE }}
      axisLine={false}
      tickLine={false}
      label={
        dual
          ? {
              value: metricLabel(metric),
              angle: index === 1 ? 90 : -90,
              position: index === 1 ? 'insideRight' : 'insideLeft',
              className: 'fill-slate-500',
              style: { fontSize: COMPARE_TICK_FONT_SIZE, textAnchor: 'middle' },
            }
          : undefined
      }
    />
  ))

  const common = [
    <CartesianGrid key="grid" vertical={false} stroke={COMPARE_GRID_COLOR} />,
    <XAxis
      key="x"
      dataKey="bucket"
      tickFormatter={formatDate}
      tick={{ fontSize: COMPARE_TICK_FONT_SIZE }}
      tickLine={false}
      axisLine={false}
      minTickGap={24}
    />,
    ...axes,
    <Tooltip
      key="tooltip"
      wrapperStyle={{ zIndex: COMPARE_TOOLTIP_Z_INDEX }}
      cursor={mode === 'bar' ? { fill: COMPARE_CURSOR_FILL } : { stroke: COMPARE_CURSOR_STROKE }}
      content={({ active, payload, label }) => {
        if (!active || !payload?.length) return null
        return (
          <div className="min-w-[12rem] rounded-lg border border-slate-200 dark:border-primary/30 bg-white dark:bg-background-dark px-3 py-2 shadow-md">
            <p className="text-xs font-bold text-slate-900 dark:text-slate-100">{formatFullDate(String(label))}</p>
            <ul className="mt-1 space-y-1">
              {data.series.map((series) => {
                const entry = payload.find((item) => item.dataKey === series.key)
                if (!entry) return null
                return (
                  <li key={series.key} className="flex items-center justify-between gap-3 text-[11px]">
                    <span className="inline-flex items-center gap-1.5 text-slate-600 dark:text-slate-300">
                      <span className="inline-block size-2.5 rounded-sm" style={{ backgroundColor: colorOf(series) }} />
                      {nameOf(series)}
                    </span>
                    <span className="font-mono font-bold tabular-nums text-slate-900 dark:text-slate-100">
                      ${formatUsd(Number(entry.value))}
                    </span>
                  </li>
                )
              })}
            </ul>
          </div>
        )
      }}
    />,
  ]

  return (
    <div>
      <ul className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-slate-700 dark:text-slate-200">
        {data.series.map((series) => (
          <li key={series.key} className="inline-flex items-center gap-1.5">
            <svg width="18" height="10" aria-hidden="true">
              {mode === 'line' ? (
                <line
                  x1="0"
                  y1="5"
                  x2="18"
                  y2="5"
                  stroke={colorOf(series)}
                  strokeWidth={COMPARE_LINE_WIDTH}
                  strokeDasharray={series.tradeType === 'futures' ? COMPARE_DASH : undefined}
                  strokeLinecap="round"
                />
              ) : (
                <rect
                  x="1"
                  y="1"
                  width="16"
                  height="8"
                  rx="2"
                  fill={colorOf(series)}
                  fillOpacity={series.tradeType === 'futures' ? COMPARE_ALT_TYPE_OPACITY : 1}
                  stroke={colorOf(series)}
                  strokeWidth={COMPARE_BAR_STROKE_WIDTH}
                />
              )}
            </svg>
            {nameOf(series)}
          </li>
        ))}
      </ul>
      <p className="mb-2 text-[11px] text-slate-500">
        {data.bucketing === 'week' ? c.weekly : c.daily} · {c.futuresStyle}
      </p>

      <div
        className={AXIS_TICK_CLASS}
        style={{ height: COMPARE_CHART_HEIGHT }}
        role="img"
        aria-label={c.chartLabel}
      >
        <ResponsiveContainer width="100%" height="100%">
          {mode === 'line' ? (
            <LineChart data={data.rows} margin={COMPARE_CHART_MARGIN}>
              {common}
              {data.series.map((series) => (
                <Line
                  key={series.key}
                  type="monotone"
                  dataKey={series.key}
                  yAxisId={axisOf(series.metric)}
                  stroke={colorOf(series)}
                  strokeWidth={COMPARE_LINE_WIDTH}
                  strokeDasharray={series.tradeType === 'futures' ? COMPARE_DASH : undefined}
                  dot={showDots ? { r: COMPARE_DOT_RADIUS - 1, fill: colorOf(series), strokeWidth: 0 } : false}
                  activeDot={{ r: COMPARE_ACTIVE_DOT_RADIUS }}
                  isAnimationActive={false}
                />
              ))}
            </LineChart>
          ) : (
            <BarChart data={data.rows} margin={COMPARE_CHART_MARGIN}>
              {common}
              {data.series.map((series) => (
                <Bar
                  key={series.key}
                  dataKey={series.key}
                  yAxisId={axisOf(series.metric)}
                  fill={colorOf(series)}
                  fillOpacity={series.tradeType === 'futures' ? COMPARE_ALT_TYPE_OPACITY : 1}
                  stroke={colorOf(series)}
                  strokeWidth={COMPARE_BAR_STROKE_WIDTH}
                  maxBarSize={COMPARE_BAR_MAX_SIZE}
                  radius={COMPARE_BAR_RADIUS}
                  isAnimationActive={false}
                />
              ))}
            </BarChart>
          )}
        </ResponsiveContainer>
      </div>

      <div className="sr-only">
        <table>
          <caption>{c.chartLabel}</caption>
          <thead>
            <tr>
              <th scope="col">{c.date}</th>
              {data.series.map((series) => (
                <th key={series.key} scope="col">
                  {nameOf(series)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.rows.map((row) => (
              <tr key={row.bucket}>
                <th scope="row">{formatFullDate(row.bucket)}</th>
                {data.series.map((series) => (
                  <td key={series.key}>${formatUsd(Number(row[series.key]))}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
