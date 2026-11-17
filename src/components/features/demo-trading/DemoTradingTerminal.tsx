'use client'

import { useMemo, useState } from 'react'
import { useT } from '@/lib/i18n/client'
import { fillTemplate } from '@/lib/i18n/format'
import {
  DEMO_CHART_MODES,
  DEMO_DEFAULT_SYMBOL,
  DEMO_MARKET_PAIRS,
} from '@/lib/config/demoTrading'
import { calculateDemoEquity, canRefillDemoBalance } from '@/lib/engines/demoEngine'
import { resolveDemoTvSymbol } from '@/lib/engines/demoChartOverlays'
import { formatChangePercent, formatPrice, pnlTone } from './demoFormat'
import { OpenOrdersTable, OrderHistoryTable, PositionsTable, TradeHistoryTable } from './DemoTables'
import { DemoChart, type FastOrderDraft } from './DemoChart'
import { OrderForm } from './OrderForm'
import { TradingViewChart } from './TradingViewChart'
import { useChartMode } from './useChartMode'
import { PairPicker } from './PairPicker'
import { useDemoAccount } from './useDemoAccount'
import { useDemoPrices } from './useDemoPrices'

type BottomTab = 'positions' | 'openOrders' | 'orderHistory' | 'tradeHistory'

export function DemoTradingTerminal(): React.JSX.Element {
  const { t } = useT()
  const d = t.demo
  const [symbol, setSymbol] = useState(DEMO_DEFAULT_SYMBOL)
  const [tab, setTab] = useState<BottomTab>('positions')
  const [chartMode, setChartMode] = useChartMode()
  const [draft, setDraft] = useState<FastOrderDraft | null>(null)
  const account = useDemoAccount()
  const tradedOrders = useMemo(
    () => [...account.positions, ...account.closedTrades],
    [account.positions, account.closedTrades]
  )

  const pair = DEMO_MARKET_PAIRS.find((item) => item.symbol === symbol) ?? DEMO_MARKET_PAIRS[0]
  const trackedSymbols = [
    ...DEMO_MARKET_PAIRS.map((item) => item.symbol),
  ]
  const { prices, changes } = useDemoPrices(trackedSymbols)
  const livePrice = prices[pair.symbol] ?? null

  const equity =
    account.balance !== null
      ? calculateDemoEquity({
          balance: account.balance,
          positions: account.positions.map((position) => ({
            ...position,
            markPrice: prices[position.symbol] ?? null,
          })),
          pending: account.pendingOrders,
        })
      : null
  const canRefill = equity !== null && canRefillDemoBalance(equity)

  const tabs: { key: BottomTab; label: string }[] = [
    { key: 'positions', label: fillTemplate(d.tabs.positions, { count: account.positions.length }) },
    { key: 'openOrders', label: fillTemplate(d.tabs.openOrders, { count: account.pendingOrders.length }) },
    { key: 'orderHistory', label: d.tabs.orderHistory },
    { key: 'tradeHistory', label: d.tabs.tradeHistory },
  ]

  return (
    <div className="flex flex-1 h-full overflow-hidden flex-col xl:flex-row">
      <section className="flex-1 flex flex-col min-w-0 min-h-0 bg-background-dark">
        <div className="min-h-12 border-b border-primary/10 flex items-center px-3 md:px-4 gap-3 md:gap-6 shrink-0 bg-panel-dark/50 flex-wrap py-2">
          <PairPicker selected={pair} prices={prices} changes={changes} onSelect={setSymbol} />
          <span className="font-mono text-primary font-bold text-lg tabular-nums">
            {livePrice !== null ? formatPrice(livePrice) : d.updating}
          </span>
          <span className={`font-mono font-bold text-sm tabular-nums ${pnlTone(changes[pair.symbol])}`}>
            {formatChangePercent(changes[pair.symbol])}
          </span>
        </div>

        <div className="flex items-center gap-1 px-3 py-1.5 border-b border-primary/10 shrink-0 bg-panel-dark/30">
          <div className="grid grid-cols-2 gap-1 p-0.5 rounded-lg bg-panel-dark border border-primary/20" role="group" aria-label={d.chart.modeLabel}>
            {DEMO_CHART_MODES.map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setChartMode(mode)}
                aria-pressed={chartMode === mode}
                className={`px-3 py-1 text-[11px] font-bold rounded transition-colors ${
                  chartMode === mode ? 'bg-primary/15 text-primary' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {d.chart.modes[mode]}
              </button>
            ))}
          </div>
        </div>

        <div className="relative overflow-hidden h-[42vh] min-h-[260px] xl:flex-1 xl:h-auto">
          {chartMode === 'trading' ? (
            <DemoChart
              pair={pair}
              livePrice={livePrice}
              balance={account.balance}
              positions={account.positions}
              pendingOrders={account.pendingOrders}
              tradedOrders={tradedOrders}
              draft={draft}
              onFastOrder={account.placeOrder}
              onUpdateOrder={account.updateOrder}
            />
          ) : (
            <TradingViewChart tvSymbol={resolveDemoTvSymbol(pair)} />
          )}
        </div>

        <div className="h-64 md:h-60 border-t border-primary/10 flex flex-col shrink-0 bg-panel-dark">
          <div className="flex border-b border-primary/10 shrink-0 overflow-x-auto" role="tablist">
            {tabs.map((item) => (
              <button
                key={item.key}
                type="button"
                role="tab"
                aria-selected={tab === item.key}
                onClick={() => setTab(item.key)}
                className={`px-4 py-2 text-xs font-bold transition-colors whitespace-nowrap ${
                  tab === item.key
                    ? 'border-b-2 border-primary text-primary'
                    : 'text-slate-500 hover:text-slate-300'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>

          <div className="flex-1 overflow-auto">
            {tab === 'positions' && (
              <PositionsTable
                positions={account.positions}
                prices={prices}
                balance={account.balance}
                onClose={account.closePosition}
                onUpdate={account.updateOrder}
              />
            )}
            {tab === 'openOrders' && (
              <OpenOrdersTable
                orders={account.pendingOrders}
                prices={prices}
                balance={account.balance}
                onCancel={(id) => void account.cancelOrder(id)}
                onUpdate={account.updateOrder}
              />
            )}
            {tab === 'orderHistory' && <OrderHistoryTable orders={account.orderHistory} />}
            {tab === 'tradeHistory' && <TradeHistoryTable trades={account.closedTrades} />}
          </div>
        </div>
      </section>

      <OrderForm
        pair={pair}
        livePrice={livePrice}
        balance={account.balance}
        canRefill={canRefill}
        onSubmit={account.placeOrder}
        onRefill={account.refill}
        onDraftChange={setDraft}
      />
    </div>
  )
}
