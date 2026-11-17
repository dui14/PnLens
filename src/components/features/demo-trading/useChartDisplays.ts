'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  DEMO_CHART_DISPLAY_DEFAULTS,
  DEMO_CHART_DISPLAY_KEYS,
  DEMO_CHART_DISPLAY_STORAGE_KEY,
  type DemoChartDisplayKey,
} from '@/lib/config/demoTrading'
import type { DemoChartDisplays } from '@/lib/engines/demoChartOverlays'

function readStored(): DemoChartDisplays {
  try {
    const raw = window.localStorage.getItem(DEMO_CHART_DISPLAY_STORAGE_KEY)
    if (!raw) return DEMO_CHART_DISPLAY_DEFAULTS
    const parsed = JSON.parse(raw) as Partial<Record<DemoChartDisplayKey, unknown>>
    const next = { ...DEMO_CHART_DISPLAY_DEFAULTS }
    for (const key of DEMO_CHART_DISPLAY_KEYS) {
      if (typeof parsed[key] === 'boolean') next[key] = parsed[key]
    }
    return next
  } catch {
    return DEMO_CHART_DISPLAY_DEFAULTS
  }
}

export function useChartDisplays(): [DemoChartDisplays, (key: DemoChartDisplayKey) => void] {
  const [displays, setDisplays] = useState<DemoChartDisplays>(DEMO_CHART_DISPLAY_DEFAULTS)

  useEffect(() => {
    setDisplays(readStored())
  }, [])

  const toggle = useCallback((key: DemoChartDisplayKey): void => {
    setDisplays((previous) => {
      const next = { ...previous, [key]: !previous[key] }
      try {
        window.localStorage.setItem(DEMO_CHART_DISPLAY_STORAGE_KEY, JSON.stringify(next))
      } catch {
        return next
      }
      return next
    })
  }, [])

  return [displays, toggle]
}
