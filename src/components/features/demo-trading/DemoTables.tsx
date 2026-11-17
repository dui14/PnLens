'use client'

import { useT } from '@/lib/i18n/client'
import {
  calculateDemoLiquidationPrice,
  calculateDemoUnrealizedPNL,
} from '@/lib/engines/demoEngine'
import type { DemoTrade } from '@/lib/types'
import {
  EMPTY_VALUE,
  formatAmount,
  formatPrice,
  formatQuantity,
  formatSigned,
  formatTime,
  pnlTone,
  sideTone,
} from './demoFormat'
import { CloseControl, EditableLevels } from './OrderActions'
import type { DemoCloseOptions, DemoUpdatePatch } from './useDemoAccount'

const TABLE_CLASS = 'w-full text-left text-[11px] whitespace-nowrap'
const HEAD_CLASS = 'text-slate-500 border-b border-primary/5 sticky top-0 bg-panel-dark'
const CELL_CLASS = 'px-2 py-1.5 align-middle'
const NUM_CLASS = `${CELL_CLASS} font-mono tabular-nums text-right`
const ROW_CLASS = 'border-b border-primary/5'
const ACTION_CLASS =
  'px-2 py-0.5 rounded bg-slate-800 hover:bg-rose-500/20 hover:text-rose-400 text-[10px] transition-colors'

function Head({ labels, rightFrom }: { labels: string[]; rightFrom: number }): React.JSX.Element {
  return (
    <thead className={HEAD_CLASS}>
      <tr>
        {labels.map((label, index) => (
          <th key={label} className={`${CELL_CLASS} font-medium ${index >= rightFrom ? 'text-right' : ''}`}>
            {label}
          </th>
        ))}
      </tr>
    </thead>
  )
}

function Empty({ text }: { text: string }): React.JSX.Element {
  return <div className="flex items-center justify-center h-full text-slate-600 text-xs">{text}</div>
}

function SymbolCell({ trade }: { trade: DemoTrade }): React.JSX.Element {
  const { t } = useT()
  const d = t.demo
  return (
    <td className={CELL_CLASS}>
      <div className="font-bold">{trade.symbol}</div>
      <div className="text-[10px] leading-tight">
        <span className={`font-bold ${sideTone(trade.side)}`}>{trade.side === 'buy' ? d.buy : d.sell}</span>
        <span className="text-slate-500">
          {' '}
          {trade.leverage != null ? `${trade.leverage}x` : EMPTY_VALUE} {(trade.margin_mode ?? '').toUpperCase()}
        </span>
      </div>
    </td>
  )
}

function TpSlCell({ trade }: { trade: DemoTrade }): React.JSX.Element {
  return (
    <td className={`${CELL_CLASS} font-mono tabular-nums text-right`}>
      <div className="text-emerald-400">{trade.take_profit != null ? formatPrice(trade.take_profit) : EMPTY_VALUE}</div>
      <div className="text-rose-400">{trade.stop_loss != null ? formatPrice(trade.stop_loss) : EMPTY_VALUE}</div>
    </td>
  )
}

type PositionsTableProps = {
  positions: DemoTrade[]
  prices: Record<string, number>
  balance: number | null
  onClose: (tradeId: string, options: DemoCloseOptions) => Promise<string | null>
  onUpdate: (tradeId: string, patch: DemoUpdatePatch) => Promise<string | null>
}

export function PositionsTable({ positions, prices, balance, onClose, onUpdate }: PositionsTableProps): React.JSX.Element {
  const { t } = useT()
  const d = t.demo

  if (positions.length === 0) return <Empty text={d.empty.positions} />

  return (
    <table className={TABLE_CLASS}>
      <Head
        labels={[
          d.cols.symbol,
          d.cols.quantity,
          d.cols.entryPrice,
          d.cols.markPrice,
          d.cols.liqPrice,
          d.cols.margin,
          d.cols.pnl,
          d.cols.tpSl,
          d.cols.action,
        ]}
        rightFrom={1}
      />
      <tbody>
        {positions.map((position) => {
          const mark = prices[position.symbol] ?? null
          const margin = position.initial_margin ?? 0
          const pnl =
            mark !== null
              ? calculateDemoUnrealizedPNL(position.side, position.entry_price, mark, position.quantity)
              : null
          const roe = pnl !== null && margin > 0 ? (pnl / margin) * 100 : null
          const liquidation = calculateDemoLiquidationPrice({
            side: position.side,
            entryPrice: position.entry_price,
            quantity: position.quantity,
            margin,
            marginMode: position.margin_mode ?? 'cross',
            availableBalance: balance ?? 0,
          })

          return (
            <tr key={position.id} className={ROW_CLASS}>
              <SymbolCell trade={position} />
              <td className={NUM_CLASS}>{formatQuantity(position.quantity)}</td>
              <td className={NUM_CLASS}>{formatPrice(position.entry_price)}</td>
              <td className={`${NUM_CLASS} text-primary`}>{formatPrice(mark)}</td>
              <td className={`${NUM_CLASS} text-amber-400`}>
                {liquidation !== null && liquidation > 0 ? formatPrice(liquidation) : EMPTY_VALUE}
              </td>
              <td className={NUM_CLASS}>{formatAmount(margin)}</td>
              <td className={`${NUM_CLASS} font-bold ${pnlTone(pnl)}`}>
                <div>{formatSigned(pnl, 4)}</div>
                <div className="text-[10px] font-normal">
                  {roe !== null ? `${formatSigned(roe)}%` : EMPTY_VALUE}
                </div>
              </td>
              <td className={CELL_CLASS}>
                <EditableLevels trade={position} markPrice={mark} balance={balance} showPrice={false} onUpdate={onUpdate} />
              </td>
              <td className={`${CELL_CLASS} text-right`}>
                <CloseControl trade={position} onClose={onClose} />
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

type OpenOrdersTableProps = {
  orders: DemoTrade[]
  prices: Record<string, number>
  balance: number | null
  onCancel: (tradeId: string) => void
  onUpdate: (tradeId: string, patch: DemoUpdatePatch) => Promise<string | null>
}

export function OpenOrdersTable({ orders, prices, balance, onCancel, onUpdate }: OpenOrdersTableProps): React.JSX.Element {
  const { t, intlLocale } = useT()
  const d = t.demo

  if (orders.length === 0) return <Empty text={d.empty.openOrders} />

  return (
    <table className={TABLE_CLASS}>
      <Head
        labels={[
          d.cols.symbol,
          d.cols.type,
          d.cols.orderPrice,
          d.cols.markPrice,
          d.cols.quantity,
          d.cols.margin,
          d.cols.tpSl,
          d.cols.time,
          d.cols.action,
        ]}
        rightFrom={2}
      />
      <tbody>
        {orders.map((order) => (
          <tr key={order.id} className={ROW_CLASS}>
            <SymbolCell trade={order} />
            <td className={`${CELL_CLASS} capitalize`}>
              {order.reduce_only ? d.actions.closeOrder : order.order_type}
            </td>
            <td className={NUM_CLASS}>{formatPrice(order.entry_price)}</td>
            <td className={`${NUM_CLASS} text-primary`}>{formatPrice(prices[order.symbol])}</td>
            <td className={NUM_CLASS}>{formatQuantity(order.quantity)}</td>
            <td className={NUM_CLASS}>{formatAmount(order.initial_margin)}</td>
            <td className={CELL_CLASS}>
              {order.reduce_only ? (
                <TpSlCell trade={order} />
              ) : (
                <EditableLevels
                  trade={order}
                  markPrice={prices[order.symbol] ?? null}
                  balance={balance}
                  showPrice
                  onUpdate={onUpdate}
                />
              )}
            </td>
            <td className={`${NUM_CLASS} text-slate-500`}>{formatTime(order.opened_at, intlLocale)}</td>
            <td className={`${CELL_CLASS} text-right`}>
              <button type="button" onClick={() => onCancel(order.id)} className={ACTION_CLASS}>
                {d.cancel}
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export function OrderHistoryTable({ orders }: { orders: DemoTrade[] }): React.JSX.Element {
  const { t, intlLocale } = useT()
  const d = t.demo

  if (orders.length === 0) return <Empty text={d.empty.orderHistory} />

  return (
    <table className={TABLE_CLASS}>
      <Head
        labels={[
          d.cols.symbol,
          d.cols.type,
          d.cols.orderPrice,
          d.cols.size,
          d.cols.notional,
          d.cols.margin,
          d.cols.tpSl,
          d.cols.time,
          d.cols.status,
        ]}
        rightFrom={2}
      />
      <tbody>
        {orders.map((order) => (
          <tr key={order.id} className={ROW_CLASS}>
            <SymbolCell trade={order} />
            <td className={`${CELL_CLASS} capitalize`}>{order.order_type}</td>
            <td className={NUM_CLASS}>{formatPrice(order.entry_price)}</td>
            <td className={NUM_CLASS}>{formatQuantity(order.quantity)}</td>
            <td className={NUM_CLASS}>{formatAmount(order.position_notional)}</td>
            <td className={NUM_CLASS}>{formatAmount(order.initial_margin)}</td>
            <TpSlCell trade={order} />
            <td className={`${NUM_CLASS} text-slate-500`}>{formatTime(order.opened_at, intlLocale)}</td>
            <td
              className={`${CELL_CLASS} text-right text-[10px] font-bold uppercase ${
                order.status === 'open' ? 'text-primary' : order.status === 'closed' ? 'text-slate-300' : 'text-slate-500'
              }`}
            >
              {d.status[order.status]}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export function TradeHistoryTable({ trades }: { trades: DemoTrade[] }): React.JSX.Element {
  const { t, intlLocale } = useT()
  const d = t.demo

  if (trades.length === 0) return <Empty text={d.empty.tradeHistory} />

  return (
    <table className={TABLE_CLASS}>
      <Head
        labels={[
          d.cols.symbol,
          d.cols.quantity,
          d.cols.entryPrice,
          d.cols.exitPrice,
          d.cols.realizedPnl,
          d.cols.reason,
          d.cols.openedAt,
          d.cols.closedAt,
        ]}
        rightFrom={1}
      />
      <tbody>
        {trades.map((trade) => (
          <tr key={trade.id} className={ROW_CLASS}>
            <SymbolCell trade={trade} />
            <td className={NUM_CLASS}>{formatQuantity(trade.quantity)}</td>
            <td className={NUM_CLASS}>{formatPrice(trade.entry_price)}</td>
            <td className={NUM_CLASS}>{formatPrice(trade.exit_price)}</td>
            <td className={`${NUM_CLASS} font-bold ${pnlTone(trade.realized_pnl)}`}>
              {formatSigned(trade.realized_pnl)}
            </td>
            <td className={`${CELL_CLASS} text-right text-slate-400`}>
              {trade.close_reason ? d.closeReason[trade.close_reason] : EMPTY_VALUE}
            </td>
            <td className={`${NUM_CLASS} text-slate-500`}>{formatTime(trade.opened_at, intlLocale)}</td>
            <td className={`${NUM_CLASS} text-slate-500`}>{formatTime(trade.closed_at, intlLocale)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
