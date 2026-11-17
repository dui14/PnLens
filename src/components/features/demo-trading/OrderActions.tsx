'use client'

import { useState } from 'react'
import { useT } from '@/lib/i18n/client'
import {
  resolveDemoTradeLiquidation,
  validateDemoTradeEdit,
  willDemoLimitFillImmediately,
  type DemoTradeEditPatch,
} from '@/lib/engines/demoEngine'
import type { DemoTrade } from '@/lib/types'
import { EMPTY_VALUE, formatPrice } from './demoFormat'
import type { DemoCloseOptions, DemoUpdatePatch } from './useDemoAccount'

const BUTTON_CLASS =
  'px-2 py-0.5 rounded bg-slate-800 hover:bg-primary/20 hover:text-primary text-[10px] transition-colors disabled:opacity-50'
const INPUT_CLASS =
  'w-24 bg-panel-dark border border-primary/20 rounded text-[11px] font-mono text-right px-1.5 py-0.5 outline-none focus:ring-1 focus:ring-primary'
const NOTE_CLASS = 'text-[10px] whitespace-normal max-w-40 text-right'

function parseField(raw: string): number | null | undefined {
  if (!raw.trim()) return null
  const value = Number(raw)
  return Number.isFinite(value) ? value : undefined
}

function useErrorText(): (code: string | null) => string | null {
  const { t } = useT()
  const codes: Record<string, string> = t.demo.errors.codes
  return (code) => (code ? (codes[code] ?? t.demo.errors.orderFailed) : null)
}

type CloseControlProps = {
  trade: DemoTrade
  onClose: (tradeId: string, options: DemoCloseOptions) => Promise<string | null>
}

export function CloseControl({ trade, onClose }: CloseControlProps): React.JSX.Element {
  const { t } = useT()
  const d = t.demo
  const errorText = useErrorText()
  const [isOpen, setIsOpen] = useState(false)
  const [orderType, setOrderType] = useState<'market' | 'limit'>('market')
  const [price, setPrice] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isBusy, setIsBusy] = useState(false)

  const submit = async (): Promise<void> => {
    setError(null)
    const value = Number(price)
    if (orderType === 'limit' && !(Number.isFinite(value) && value > 0)) {
      setError(errorText('INVALID_PRICE'))
      return
    }
    setIsBusy(true)
    const code = await onClose(trade.id, orderType === 'limit' ? { orderType, price: value } : { orderType })
    setIsBusy(false)
    if (code) {
      setError(errorText(code))
      return
    }
    setIsOpen(false)
    setPrice('')
  }

  if (!isOpen) {
    return (
      <button type="button" onClick={() => setIsOpen(true)} className={BUTTON_CLASS}>
        {d.close}
      </button>
    )
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex gap-1">
        {(['market', 'limit'] as const).map((type) => (
          <button
            key={type}
            type="button"
            onClick={() => setOrderType(type)}
            aria-pressed={orderType === type}
            className={`${BUTTON_CLASS} ${orderType === type ? 'text-primary bg-primary/15' : ''}`}
          >
            {type === 'market' ? d.market : d.limit}
          </button>
        ))}
      </div>
      {orderType === 'limit' && (
        <input
          type="number"
          min="0"
          step="any"
          value={price}
          onChange={(event) => setPrice(event.target.value)}
          placeholder={d.actions.closePrice}
          aria-label={d.actions.closePrice}
          className={INPUT_CLASS}
        />
      )}
      <div className="flex gap-1">
        <button type="button" onClick={() => void submit()} disabled={isBusy} className={BUTTON_CLASS}>
          {d.actions.confirmClose}
        </button>
        <button type="button" onClick={() => setIsOpen(false)} className={BUTTON_CLASS}>
          {d.cancel}
        </button>
      </div>
      {error && <span className={`${NOTE_CLASS} text-rose-400`}>{error}</span>}
    </div>
  )
}

type EditableLevelsProps = {
  trade: DemoTrade
  markPrice: number | null
  balance: number | null
  showPrice: boolean
  onUpdate: (tradeId: string, patch: DemoUpdatePatch) => Promise<string | null>
}

export function EditableLevels({
  trade,
  markPrice,
  balance,
  showPrice,
  onUpdate,
}: EditableLevelsProps): React.JSX.Element {
  const { t } = useT()
  const d = t.demo
  const errorText = useErrorText()
  const [isEditing, setIsEditing] = useState(false)
  const [tp, setTp] = useState('')
  const [sl, setSl] = useState('')
  const [price, setPrice] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isBusy, setIsBusy] = useState(false)

  const start = (): void => {
    setTp(trade.take_profit != null ? String(trade.take_profit) : '')
    setSl(trade.stop_loss != null ? String(trade.stop_loss) : '')
    setPrice(String(trade.entry_price))
    setError(null)
    setIsEditing(true)
  }

  const save = async (): Promise<void> => {
    const takeProfit = parseField(tp)
    const stopLoss = parseField(sl)
    const entry = Number(price)
    if (takeProfit === undefined || stopLoss === undefined || (showPrice && !Number.isFinite(entry))) {
      setError(errorText('INVALID_PRICE'))
      return
    }
    const patch: DemoTradeEditPatch = {}
    if (takeProfit !== (trade.take_profit ?? null)) patch.takeProfit = takeProfit
    if (stopLoss !== (trade.stop_loss ?? null)) patch.stopLoss = stopLoss
    if (showPrice && entry !== trade.entry_price) patch.price = entry
    if (Object.keys(patch).length === 0) {
      setIsEditing(false)
      return
    }
    const invalid = validateDemoTradeEdit(trade, patch, markPrice, resolveDemoTradeLiquidation(trade, balance ?? 0))
    if (invalid) {
      setError(errorText(invalid))
      return
    }
    setIsBusy(true)
    const code = await onUpdate(trade.id, patch)
    setIsBusy(false)
    if (code) {
      setError(errorText(code))
      return
    }
    setIsEditing(false)
  }

  if (!isEditing) {
    return (
      <div className="flex items-center justify-end gap-2">
        <div className="font-mono tabular-nums text-right">
          <div className="text-emerald-400">{trade.take_profit != null ? formatPrice(trade.take_profit) : EMPTY_VALUE}</div>
          <div className="text-rose-400">{trade.stop_loss != null ? formatPrice(trade.stop_loss) : EMPTY_VALUE}</div>
        </div>
        <button type="button" onClick={start} className={BUTTON_CLASS}>
          {d.actions.edit}
        </button>
      </div>
    )
  }

  const fillsNow = showPrice && Number(price) > 0 && willDemoLimitFillImmediately(trade.side, Number(price), markPrice)

  return (
    <div className="flex flex-col items-end gap-1">
      {showPrice && (
        <input
          type="number"
          step="any"
          value={price}
          onChange={(event) => setPrice(event.target.value)}
          aria-label={d.cols.orderPrice}
          className={INPUT_CLASS}
        />
      )}
      <input
        type="number"
        step="any"
        value={tp}
        onChange={(event) => setTp(event.target.value)}
        placeholder={d.takeProfit}
        aria-label={d.takeProfit}
        className={INPUT_CLASS}
      />
      <input
        type="number"
        step="any"
        value={sl}
        onChange={(event) => setSl(event.target.value)}
        placeholder={d.stopLoss}
        aria-label={d.stopLoss}
        className={INPUT_CLASS}
      />
      {fillsNow && <span className={`${NOTE_CLASS} text-amber-400`}>{d.actions.fillsImmediately}</span>}
      <div className="flex gap-1">
        <button type="button" onClick={() => void save()} disabled={isBusy} className={BUTTON_CLASS}>
          {d.actions.save}
        </button>
        <button type="button" onClick={() => setIsEditing(false)} className={BUTTON_CLASS}>
          {d.cancel}
        </button>
      </div>
      {error && <span className={`${NOTE_CLASS} text-rose-400`}>{error}</span>}
    </div>
  )
}
