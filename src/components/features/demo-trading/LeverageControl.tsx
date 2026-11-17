'use client'

import { useT } from '@/lib/i18n/client'
import {
  DEMO_LEVERAGE_PRESETS,
  DEMO_MAX_LEVERAGE,
  DEMO_MIN_LEVERAGE,
} from '@/lib/config/demoTrading'
import { clampDemoLeverage } from '@/lib/engines/demoEngine'

type LeverageControlProps = {
  value: number
  onChange: (value: number) => void
}

export function LeverageControl({ value, onChange }: LeverageControlProps): React.JSX.Element {
  const { t } = useT()
  const d = t.demo

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase text-slate-500 font-bold">{d.leverage}</span>
        <span className="font-mono font-bold text-sm text-primary">{value}x</span>
      </div>
      <input
        type="range"
        min={DEMO_MIN_LEVERAGE}
        max={DEMO_MAX_LEVERAGE}
        step={1}
        value={value}
        aria-label={d.leverageSlider}
        onChange={(event) => onChange(clampDemoLeverage(Number(event.target.value)))}
        className="w-full accent-primary cursor-pointer"
      />
      <div className="flex flex-wrap gap-1">
        {DEMO_LEVERAGE_PRESETS.map((preset) => (
          <button
            key={preset}
            type="button"
            onClick={() => onChange(preset)}
            aria-pressed={value === preset}
            className={`px-2 py-1 rounded text-[11px] font-mono font-bold border transition-colors ${
              value === preset
                ? 'border-primary text-primary bg-primary/10'
                : 'border-primary/20 text-slate-400 bg-panel-dark hover:border-primary/40'
            }`}
          >
            {preset}x
          </button>
        ))}
      </div>
    </div>
  )
}
