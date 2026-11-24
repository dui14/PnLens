'use client'

import { useEffect, useState } from 'react'
import { useT } from '@/lib/i18n/client'
import { fillTemplate } from '@/lib/i18n/format'
import {
  DEMO_DEFAULT_LEVERAGE,
  DEMO_DEFAULT_SIZE_MODE,
  DEMO_MAX_SIZE_INPUT,
  DEMO_REFILL_BALANCE,
  DEMO_REFILL_THRESHOLD,
  DEMO_TAKER_FEE_RATE,
  type DemoMarketPair,
  type DemoSizeMode,
} from '@/lib/config/demoTrading'
import {
  calculateDemoEntryFee,
  calculateDemoLiquidationPrice,
  resolveDemoPercentSize,
  resolveDemoSizing,
  resolveDemoSizingPrice,
  type DemoMarginMode,
  type DemoSide,
} from '@/lib/engines/demoEngine'
import { EMPTY_VALUE, formatAmount, formatPrice } from './demoFormat'
import type { FastOrderDraft } from './DemoChart'
import { LeverageControl } from './LeverageControl'
import { OrderSizeInput } from './OrderSizeInput'
import type { DemoOrderPayload } from './useDemoAccount'

type OrderType = 'limit' | 'market'

type OrderFormProps = {
  pair: DemoMarketPair
  livePrice: number | null
  balance: number | null
  canRefill: boolean
  onSubmit: (payload: DemoOrderPayload) => Promise<string | null>
  onRefill: () => Promise<string | null>
  onDraftChange: (draft: FastOrderDraft) => void
}

const FIELD_CLASS =
  'w-full bg-panel-dark border border-primary/20 rounded-lg text-sm font-mono font-bold text-right px-3 py-2 focus:ring-1 focus:ring-primary outline-none'
const LABEL_CLASS = 'text-[10px] uppercase text-slate-500 font-bold'

function parseOptional(raw: string): number | null | undefined {
  if (!raw.trim()) return null
  const value = parseFloat(raw)
  return Number.isFinite(value) && value > 0 ? value : undefined
}

export function OrderForm({
  pair,
  livePrice,
  balance,
  canRefill,
  onSubmit,
  onRefill,
  onDraftChange,
}: OrderFormProps): React.JSX.Element {
  const { t } = useT()
  const d = t.demo
  const [side, setSide] = useState<DemoSide>('buy')
  const [orderType, setOrderType] = useState<OrderType>('market')
  const [marginMode, setMarginMode] = useState<DemoMarginMode>('cross')
  const [leverage, setLeverage] = useState<number>(DEMO_DEFAULT_LEVERAGE)
  const [limitPrice, setLimitPrice] = useState('')
  const [sizeMode, setSizeMode] = useState<DemoSizeMode>(DEMO_DEFAULT_SIZE_MODE)
  const [sizeValue, setSizeValue] = useState('')
  const [percent, setPercent] = useState<number | null>(null)
  const [takeProfit, setTakeProfit] = useState('')
  const [stopLoss, setStopLoss] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isRefilling, setIsRefilling] = useState(false)

  const limitPriceNumber = parseFloat(limitPrice)
  const referencePrice = resolveDemoSizingPrice({ orderType, limitPrice: limitPriceNumber, livePrice })
  const percentSize =
    percent !== null && balance !== null && referencePrice != null
      ? resolveDemoPercentSize({ mode: sizeMode, percent, available: balance, leverage, price: referencePrice })
      : null
  const effectiveSizeValue = percentSize !== null ? String(percentSize) : percent !== null ? '' : sizeValue
  const sizeNumber = parseFloat(effectiveSizeValue)
  const sizing =
    referencePrice != null && Number.isFinite(referencePrice)
      ? resolveDemoSizing(sizeMode, sizeNumber, leverage, referencePrice)
      : null
  const entryFee = sizing ? calculateDemoEntryFee(sizing.notional) : null
  const required = sizing && entryFee != null ? sizing.margin + entryFee : null
  const liquidation =
    sizing && referencePrice != null && required != null
      ? calculateDemoLiquidationPrice({
          side,
          entryPrice: referencePrice,
          quantity: sizing.quantity,
          margin: sizing.margin,
          marginMode,
          availableBalance: (balance ?? 0) - required,
        })
      : null
  const maxNotional = balance !== null ? balance / (1 / leverage + DEMO_TAKER_FEE_RATE) : null

  const draftSize = sizing && Number.isFinite(sizeNumber) ? sizeNumber : null
  const draftTp = parseOptional(takeProfit) ?? null
  const draftSl = parseOptional(stopLoss) ?? null

  useEffect(() => {
    onDraftChange({
      orderType,
      leverage,
      marginMode,
      sizeMode,
      size: draftSize,
      percent,
      takeProfit: draftTp,
      stopLoss: draftSl,
    })
  }, [onDraftChange, orderType, leverage, marginMode, sizeMode, draftSize, percent, draftTp, draftSl])

  const resolveError = (code: string): string => {
    const codes: Record<string, string> = d.errors.codes
    return codes[code] ?? d.errors.orderFailed
  }

  const handleSubmit = async (): Promise<void> => {
    setError(null)

    if (!sizing || sizeNumber > DEMO_MAX_SIZE_INPUT) {
      setError(d.errors.sizeInvalid)
      return
    }
    if (orderType === 'limit' && (!Number.isFinite(limitPriceNumber) || limitPriceNumber <= 0)) {
      setError(d.errors.priceInvalid)
      return
    }
    if (required !== null && balance !== null && required > balance) {
      setError(d.errors.balanceTooLow)
      return
    }

    const tp = parseOptional(takeProfit)
    const sl = parseOptional(stopLoss)
    if (tp === undefined) {
      setError(d.errors.takeProfitInvalid)
      return
    }
    if (sl === undefined) {
      setError(d.errors.stopLossInvalid)
      return
    }

    setIsSubmitting(true)
    const code = await onSubmit({
      symbol: pair.symbol,
      side,
      orderType,
      leverage,
      marginMode,
      sizeMode,
      size: sizeNumber,
      price: orderType === 'limit' ? limitPriceNumber : null,
      takeProfit: tp,
      stopLoss: sl,
    })
    setIsSubmitting(false)

    if (code) {
      setError(resolveError(code))
      return
    }
    setSizeValue('')
    setPercent(null)
    setLimitPrice('')
    setTakeProfit('')
    setStopLoss('')
  }

  const handleRefill = async (): Promise<void> => {
    setError(null)
    setIsRefilling(true)
    const code = await onRefill()
    setIsRefilling(false)
    if (code) setError(resolveError(code))
  }

  const submitLabel =
    orderType === 'limit'
      ? side === 'buy'
        ? d.placeLimitLong
        : d.placeLimitShort
      : side === 'buy'
        ? d.openLong
        : d.openShort

  return (
    <aside className="w-full xl:w-80 border-t xl:border-t-0 xl:border-l border-primary/10 bg-background-light dark:bg-background-dark flex flex-col shrink-0 max-h-[70vh] xl:max-h-none">
      <div className="p-4 flex flex-col gap-4 overflow-y-auto flex-1 min-w-0">
        <div className="grid grid-cols-2 gap-1 p-0.5 rounded-lg bg-panel-dark border border-primary/20">
          {(['market', 'limit'] as const).map((type) => (
            <button
              key={type}
              type="button"
              onClick={() => setOrderType(type)}
              aria-pressed={orderType === type}
              className={`py-1.5 text-xs font-bold rounded transition-colors ${
                orderType === type ? 'bg-primary/15 text-primary' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {type === 'market' ? d.market : d.limit}
            </button>
          ))}
        </div>

        <div className="space-y-2">
          <span className={LABEL_CLASS}>{d.marginMode}</span>
          <div className="grid grid-cols-2 gap-2">
            {(['cross', 'isolated'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setMarginMode(mode)}
                aria-pressed={marginMode === mode}
                className={`py-2 text-[11px] font-bold rounded border transition-colors ${
                  marginMode === mode
                    ? 'border-primary text-primary bg-primary/10'
                    : 'border-primary/20 text-slate-400 bg-panel-dark'
                }`}
              >
                {mode === 'cross' ? d.cross : d.isolated}
              </button>
            ))}
          </div>
          <p className="text-[11px] leading-snug text-slate-500 break-words">
            {marginMode === 'cross' ? d.crossHint : d.isolatedHint}
          </p>
        </div>

        <LeverageControl value={leverage} onChange={setLeverage} />

        <div className="space-y-2">
          <label className={LABEL_CLASS}>{orderType === 'limit' ? d.priceUsdt : d.marketPriceLabel}</label>
          {orderType === 'limit' ? (
            <input
              type="number"
              min="0"
              step="any"
              inputMode="decimal"
              value={limitPrice}
              onChange={(event) => setLimitPrice(event.target.value)}
              placeholder={livePrice !== null ? formatPrice(livePrice) : '0.00'}
              className={FIELD_CLASS}
            />
          ) : (
            <div className={`${FIELD_CLASS} text-slate-400`}>{d.marketPriceValue}</div>
          )}
        </div>

        <OrderSizeInput
          mode={sizeMode}
          value={effectiveSizeValue}
          baseAsset={pair.baseAsset}
          sizing={sizing}
          percent={percent}
          onPercentSelect={setPercent}
          onModeChange={(mode) => {
            setSizeMode(mode)
            setSizeValue('')
          }}
          onValueChange={(value) => {
            setPercent(null)
            setSizeValue(value)
          }}
        />

        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-2 min-w-0">
            <label className={LABEL_CLASS}>{d.takeProfit}</label>
            <input
              type="number"
              min="0"
              step="any"
              value={takeProfit}
              onChange={(event) => setTakeProfit(event.target.value)}
              placeholder={d.optional}
              className={FIELD_CLASS}
            />
          </div>
          <div className="space-y-2 min-w-0">
            <label className={LABEL_CLASS}>{d.stopLoss}</label>
            <input
              type="number"
              min="0"
              step="any"
              value={stopLoss}
              onChange={(event) => setStopLoss(event.target.value)}
              placeholder={d.optional}
              className={FIELD_CLASS}
            />
          </div>
        </div>

        <dl className="border-t border-primary/10 pt-3 space-y-2 text-[11px]">
          {[
            { label: d.availableBalance, value: balance !== null ? `${formatAmount(balance, 2)} USDT` : EMPTY_VALUE },
            { label: d.entryFee, value: entryFee !== null ? `${formatAmount(entryFee)} USDT` : EMPTY_VALUE },
            { label: d.requiredBalance, value: required !== null ? `${formatAmount(required)} USDT` : EMPTY_VALUE },
            {
              label: d.liqEstimate,
              value: liquidation !== null && liquidation > 0 ? `${formatPrice(liquidation)} USDT` : EMPTY_VALUE,
            },
            { label: d.maxNotional, value: maxNotional !== null ? `${formatAmount(maxNotional, 2)} USDT` : EMPTY_VALUE },
          ].map((row) => (
            <div key={row.label} className="flex justify-between gap-3">
              <dt className="text-slate-500">{row.label}</dt>
              <dd className="font-mono font-bold text-right truncate">{row.value}</dd>
            </div>
          ))}
        </dl>

        {canRefill && (
          <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 space-y-2">
            <p className="text-[11px] leading-snug text-slate-400 break-words">
              {fillTemplate(d.refill.hint, { threshold: DEMO_REFILL_THRESHOLD.toLocaleString('en-US') })}
            </p>
            <button
              type="button"
              onClick={handleRefill}
              disabled={isRefilling}
              className="w-full py-2 rounded-lg border border-primary text-primary text-xs font-bold hover:bg-primary/10 transition-colors disabled:opacity-50"
            >
              {isRefilling
                ? d.processing
                : fillTemplate(d.refill.button, { amount: DEMO_REFILL_BALANCE.toLocaleString('en-US') })}
            </button>
          </div>
        )}

        {error && <p className="text-[11px] text-rose-400 font-bold text-center break-words">{error}</p>}
      </div>

      <div className="p-4 pt-3 border-t border-primary/10 space-y-3 shrink-0">
        <div className="grid grid-cols-2 gap-2" role="group" aria-label={d.side}>
          <button
            type="button"
            onClick={() => setSide('buy')}
            aria-pressed={side === 'buy'}
            className={`py-2 text-xs font-bold rounded border transition-colors ${
              side === 'buy'
                ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/40'
                : 'bg-slate-800 text-slate-400 border-transparent'
            }`}
          >
            {d.buy}
          </button>
          <button
            type="button"
            onClick={() => setSide('sell')}
            aria-pressed={side === 'sell'}
            className={`py-2 text-xs font-bold rounded border transition-colors ${
              side === 'sell'
                ? 'bg-rose-500/15 text-rose-400 border-rose-500/40'
                : 'bg-slate-800 text-slate-400 border-transparent'
            }`}
          >
            {d.sell}
          </button>
        </div>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={isSubmitting}
          className={`w-full py-3 text-white font-bold rounded-xl shadow-lg transition-all text-sm disabled:opacity-50 disabled:cursor-not-allowed ${
            side === 'buy'
              ? 'bg-emerald-500 hover:bg-emerald-600 shadow-emerald-500/20'
              : 'bg-rose-500 hover:bg-rose-600 shadow-rose-500/20'
          }`}
        >
          {isSubmitting && (
            <span
              aria-hidden="true"
              className="inline-block w-4 h-4 mr-2 align-[-2px] rounded-full border-2 border-white/40 border-t-white animate-spin"
            />
          )}
          {isSubmitting ? d.processing : submitLabel}
        </button>
      </div>
    </aside>
  )
}
