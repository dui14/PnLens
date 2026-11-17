'use client'

import { useT } from '@/lib/i18n/client'
import { fillTemplate } from '@/lib/i18n/format'
import { DEMO_SIZE_MODES, DEMO_SIZE_PERCENT_PRESETS, type DemoSizeMode } from '@/lib/config/demoTrading'
import type { DemoSizing } from '@/lib/engines/demoEngine'
import { formatAmount, formatQuantity } from './demoFormat'

type OrderSizeInputProps = {
  mode: DemoSizeMode
  value: string
  baseAsset: string
  sizing: DemoSizing | null
  percent: number | null
  onPercentSelect: (percent: number) => void
  onModeChange: (mode: DemoSizeMode) => void
  onValueChange: (value: string) => void
}

export function OrderSizeInput({
  mode,
  value,
  baseAsset,
  sizing,
  percent,
  onPercentSelect,
  onModeChange,
  onValueChange,
}: OrderSizeInputProps): React.JSX.Element {
  const { t } = useT()
  const d = t.demo

  const derivedParts = sizing
    ? DEMO_SIZE_MODES.filter((item) => item !== mode).map((item) => {
        const amount =
          item === 'quantity'
            ? formatQuantity(sizing.quantity)
            : formatAmount(item === 'cost' ? sizing.margin : sizing.notional, 2)
        return fillTemplate(d.derived[item], { amount, asset: baseAsset })
      })
    : []

  return (
    <div className="space-y-2 min-w-0">
      <span className="text-[10px] uppercase text-slate-500 font-bold">{d.sizeMode}</span>
      <div className="grid grid-cols-3 gap-1 p-0.5 rounded-lg bg-panel-dark border border-primary/20">
        {DEMO_SIZE_MODES.map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => onModeChange(item)}
            aria-pressed={mode === item}
            className={`py-1.5 text-[11px] font-bold rounded transition-colors truncate ${
              mode === item ? 'bg-primary/15 text-primary' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            {d.sizeModes[item]}
          </button>
        ))}
      </div>
      <div className="relative">
        <input
          type="number"
          min="0"
          step="any"
          inputMode="decimal"
          value={value}
          onChange={(event) => onValueChange(event.target.value)}
          placeholder="0.00"
          aria-label={d.sizeModes[mode]}
          className="w-full bg-panel-dark border border-primary/20 rounded-lg text-sm font-mono font-bold text-right pl-3 pr-16 py-2 focus:ring-1 focus:ring-primary outline-none"
        />
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] font-bold text-slate-500 pointer-events-none">
          {fillTemplate(d.sizeUnits[mode], { asset: baseAsset })}
        </span>
      </div>
      <div className="grid grid-cols-5 gap-1" role="group" aria-label={d.sizePercentLabel}>
        {DEMO_SIZE_PERCENT_PRESETS.map((preset) => (
          <button
            key={preset}
            type="button"
            onClick={() => onPercentSelect(preset)}
            aria-pressed={percent === preset}
            aria-label={fillTemplate(d.sizePercent, { percent: preset })}
            className={`py-1 text-[11px] font-bold rounded border transition-colors ${
              percent === preset
                ? 'border-primary text-primary bg-primary/10'
                : 'border-primary/20 text-slate-400 bg-panel-dark hover:text-slate-200'
            }`}
          >
            {preset}%
          </button>
        ))}
      </div>
      <p className="text-[11px] leading-snug text-slate-500 break-words">
        {derivedParts.length > 0
          ? `≈ ${derivedParts.join(' · ')}`
          : fillTemplate(d.sizeHints[mode], { asset: baseAsset })}
      </p>
    </div>
  )
}
