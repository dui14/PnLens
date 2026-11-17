'use client'

import { useEffect, useRef, useState } from 'react'
import { useT } from '@/lib/i18n/client'
import { DEMO_CHART_DISPLAY_KEYS, type DemoChartDisplayKey } from '@/lib/config/demoTrading'
import type { DemoChartDisplays } from '@/lib/engines/demoChartOverlays'

type OtherDisplaysProps = {
  displays: DemoChartDisplays
  onToggle: (key: DemoChartDisplayKey) => void
}

export function OtherDisplays({ displays, onToggle }: OtherDisplaysProps): React.JSX.Element {
  const { t } = useT()
  const d = t.demo.chart
  const [isOpen, setIsOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!isOpen) return
    const handle = (event: MouseEvent): void => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setIsOpen(false)
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [isOpen])

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        aria-expanded={isOpen}
        className="inline-flex items-center gap-1 rounded-md border border-primary/20 px-2 py-1 text-[11px] font-bold text-slate-300 hover:border-primary/40 hover:bg-primary/5 transition-colors"
      >
        {d.otherDisplays}
        <span className="material-symbols-outlined text-sm">{isOpen ? 'expand_less' : 'expand_more'}</span>
      </button>
      {isOpen && (
        <div className="absolute right-0 top-[calc(100%+6px)] z-30 w-56 rounded-lg border border-primary/20 bg-[#202630] p-2 shadow-2xl">
          {DEMO_CHART_DISPLAY_KEYS.map((key) => (
            <label
              key={key}
              className="flex items-center gap-2 px-2 py-1.5 text-xs text-slate-200 cursor-pointer rounded hover:bg-primary/5"
            >
              <input
                type="checkbox"
                checked={displays[key]}
                onChange={() => onToggle(key)}
                className="accent-[#5f4a8c]"
              />
              {d.displays[key]}
            </label>
          ))}
        </div>
      )}
    </div>
  )
}
