import type { PnlPeriod } from '@/lib/types'

export const COMPARE_MIN_EXCHANGES = 1
export const COMPARE_MIN_TYPES = 1

export const COMPARE_METRICS = ['fee', 'volume'] as const
export type CompareMetric = (typeof COMPARE_METRICS)[number]

export const COMPARE_CHART_MODES = ['line', 'bar'] as const
export type CompareChartMode = (typeof COMPARE_CHART_MODES)[number]

export const COMPARE_PERIOD_DAYS: Record<Exclude<PnlPeriod, 'year'>, number> = {
  today: 1,
  d7: 7,
  d30: 30,
  d90: 90,
}

export const COMPARE_WEEKLY_THRESHOLD_DAYS = 120
export const COMPARE_DOT_MAX_POINTS = 31
export const COMPARE_CHART_HEIGHT = 360
export const COMPARE_CHART_MARGIN = { top: 12, right: 8, bottom: 4, left: 0 } as const
export const COMPARE_LINE_WIDTH = 2
export const COMPARE_DOT_RADIUS = 4
export const COMPARE_DASH = '6 4'
export const COMPARE_ALT_TYPE_OPACITY = 0.55
export const COMPARE_BAR_MAX_SIZE = 18
export const COMPARE_BAR_RADIUS: [number, number, number, number] = [4, 4, 0, 0]
export const COMPARE_AXIS_WIDTH = 56
export const COMPARE_TICK_FONT_SIZE = 11
export const COMPARE_COMPACT_DECIMALS = 1
export const COMPARE_TOOLTIP_Z_INDEX = 20

export const COMPARE_AXIS_IDS = { fee: 'left', volume: 'right' } as const

export const COMPARE_GRID_COLOR = 'rgba(148, 163, 184, 0.28)'
export const COMPARE_CURSOR_FILL = 'rgba(148, 163, 184, 0.14)'
export const COMPARE_CURSOR_STROKE = 'rgba(148, 163, 184, 0.7)'
export const COMPARE_ACTIVE_DOT_RADIUS = 5
export const COMPARE_BAR_STROKE_WIDTH = 1.5
