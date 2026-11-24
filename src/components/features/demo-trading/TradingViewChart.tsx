'use client'

import { useEffect } from 'react'
import {
  DEMO_TV_CONTAINER_ID,
  DEMO_TV_INTERVAL,
  DEMO_TV_SCRIPT_URL,
} from '@/lib/config/demoTrading'
import type { TradingViewWidgetConfig } from '@/lib/types'

declare global {
  interface Window {
    TradingView?: {
      widget: new (config: TradingViewWidgetConfig) => void
    }
  }
}

type TradingViewChartProps = {
  tvSymbol: string
}

export function TradingViewChart({ tvSymbol }: TradingViewChartProps): React.JSX.Element {
  useEffect(() => {
    const container = document.getElementById(DEMO_TV_CONTAINER_ID)
    if (!container) return
    let disposed = false
    container.innerHTML = ''

    const initWidget = (): void => {
      if (disposed || !window.TradingView) return
      new window.TradingView.widget({
        container_id: DEMO_TV_CONTAINER_ID,
        symbol: tvSymbol,
        interval: DEMO_TV_INTERVAL,
        timezone: 'Etc/UTC',
        theme: 'dark',
        style: '1',
        locale: 'en',
        width: '100%',
        height: '100%',
        autosize: true,
        hide_top_toolbar: false,
        hide_legend: false,
        hide_side_toolbar: false,
        save_image: true,
        allow_symbol_change: false,
        withdateranges: true,
        studies: [],
        enable_publishing: false,
        details: false,
        hotlist: false,
        calendar: false,
      })
    }

    let script: HTMLScriptElement | null = null
    if (window.TradingView) {
      initWidget()
    } else {
      script = document.querySelector<HTMLScriptElement>(`script[src="${DEMO_TV_SCRIPT_URL}"]`)
      if (script) {
        script.addEventListener('load', initWidget)
      } else {
        script = document.createElement('script')
        script.src = DEMO_TV_SCRIPT_URL
        script.async = true
        script.addEventListener('load', initWidget)
        document.head.appendChild(script)
      }
    }

    return () => {
      disposed = true
      script?.removeEventListener('load', initWidget)
      container.innerHTML = ''
    }
  }, [tvSymbol])

  return <div id={DEMO_TV_CONTAINER_ID} className="absolute inset-0" data-testid="demo-tv-chart" />
}
