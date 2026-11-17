'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  DEMO_CHART_DEFAULT_MODE,
  DEMO_CHART_MODES,
  DEMO_CHART_MODE_STORAGE_KEY,
  type DemoChartMode,
} from '@/lib/config/demoTrading'

function readStored(): DemoChartMode {
  try {
    const raw = window.localStorage.getItem(DEMO_CHART_MODE_STORAGE_KEY)
    return DEMO_CHART_MODES.find((mode) => mode === raw) ?? DEMO_CHART_DEFAULT_MODE
  } catch {
    return DEMO_CHART_DEFAULT_MODE
  }
}

export function useChartMode(): [DemoChartMode, (mode: DemoChartMode) => void] {
  const [mode, setModeState] = useState<DemoChartMode>(DEMO_CHART_DEFAULT_MODE)

  useEffect(() => {
    setModeState(readStored())
  }, [])

  const setMode = useCallback((next: DemoChartMode): void => {
    setModeState(next)
    try {
      window.localStorage.setItem(DEMO_CHART_MODE_STORAGE_KEY, next)
    } catch {
      return
    }
  }, [])

  return [mode, setMode]
}
