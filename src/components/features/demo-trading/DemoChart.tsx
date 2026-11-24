'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  CandlestickSeries,
  ColorType,
  LineStyle,
  createChart,
  createSeriesMarkers,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type Time,
  type UTCTimestamp,
} from 'lightweight-charts'
import { useT } from '@/lib/i18n/client'
import { fillTemplate } from '@/lib/i18n/format'
import {
  DEMO_CHART_CANDLE_LIMIT,
  DEMO_CHART_COLORS,
  DEMO_CHART_DEFAULT_INTERVAL,
  DEMO_CHART_DRAG_HIT_PX,
  DEMO_CHART_LOAD_MORE_THRESHOLD,
  DEMO_CHART_MAX_CANDLES,
  DEMO_CHART_PAGE_LIMIT,
  DEMO_CHART_INTERVALS,
  DEMO_CHART_LINE_WIDTH,
  DEMO_CHART_PNL_DECIMALS,
  DEMO_FUTURES_KLINES_API_URL,
  DEMO_FUTURES_PRICE_WS_URL,
  DEMO_KLINES_API_URL,
  DEMO_PRICE_WS_URL,
  type DemoChartInterval,
  type DemoMarketPair,
} from '@/lib/config/demoTrading'
import {
  buildDemoChartLines,
  buildDemoChartMarkers,
  buildDemoLineEdit,
  mergeDemoCandles,
  parseDemoLineId,
  resolveDemoOlderRequest,
  upsertDemoCandle,
  parseDemoKlineMessage,
  parseDemoKlineRow,
  resolveDemoChartPricePrecision,
  resolveDemoFastOrderSize,
  type DemoCandle,
  type DemoChartLine,
} from '@/lib/engines/demoChartOverlays'
import { resolveDemoTradeLiquidation, validateDemoTradeEdit } from '@/lib/engines/demoEngine'
import type { DemoTrade } from '@/lib/types'
import { EMPTY_VALUE, formatAmount, formatQuantity, formatSigned } from './demoFormat'
import { OtherDisplays } from './OtherDisplays'
import type { DemoOrderPayload, DemoUpdatePatch } from './useDemoAccount'
import { useChartDisplays } from './useChartDisplays'

export type FastOrderDraft = Omit<DemoOrderPayload, 'symbol' | 'side' | 'price' | 'size'> & {
  size: number | null
  percent: number | null
}

type DemoChartProps = {
  pair: DemoMarketPair
  livePrice: number | null
  balance: number | null
  positions: DemoTrade[]
  pendingOrders: DemoTrade[]
  tradedOrders: DemoTrade[]
  draft: FastOrderDraft | null
  onFastOrder: (payload: DemoOrderPayload) => Promise<string | null>
  onUpdateOrder: (tradeId: string, patch: DemoUpdatePatch) => Promise<string | null>
}

type FastOrderPopover = { x: number; y: number; price: number }

type LineEdit = {
  lineId: string
  tradeId: string
  kind: DemoChartLine['kind']
  original: number
  price: number
  y: number
}

const EDITABLE_KINDS: DemoChartLine['kind'][] = ['takeProfit', 'stopLoss', 'order']

const LINE_COLORS: Record<DemoChartLine['kind'], string> = {
  position: DEMO_CHART_COLORS.position,
  order: DEMO_CHART_COLORS.order,
  takeProfit: DEMO_CHART_COLORS.takeProfit,
  stopLoss: DEMO_CHART_COLORS.stopLoss,
  liquidation: DEMO_CHART_COLORS.liquidation,
}

function toChartCandle(candle: DemoCandle): {
  time: UTCTimestamp
  open: number
  high: number
  low: number
  close: number
} {
  return { ...candle, time: candle.time as UTCTimestamp }
}

export function DemoChart({
  pair,
  livePrice,
  balance,
  positions,
  pendingOrders,
  tradedOrders,
  draft,
  onFastOrder,
  onUpdateOrder,
}: DemoChartProps): React.JSX.Element {
  const { t } = useT()
  const d = t.demo
  const [interval, setIntervalValue] = useState<DemoChartInterval>(DEMO_CHART_DEFAULT_INTERVAL)
  const [displays, toggleDisplay] = useChartDisplays()
  const [firstCandleTime, setFirstCandleTime] = useState<number | null>(null)
  const [popover, setPopover] = useState<FastOrderPopover | null>(null)
  const [fastError, setFastError] = useState<string | null>(null)
  const [isPlacing, setIsPlacing] = useState(false)
  const [edit, setEdit] = useState<LineEdit | null>(null)
  const [editError, setEditError] = useState<string | null>(null)
  const [isSavingEdit, setIsSavingEdit] = useState(false)

  const containerRef = useRef<HTMLDivElement | null>(null)
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const markersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null)
  const linesRef = useRef<Map<string, IPriceLine>>(new Map())
  const precisionRef = useRef(2)
  const fastReadyRef = useRef(false)
  const linesDataRef = useRef<DemoChartLine[]>([])
  const dragRef = useRef<LineEdit | null>(null)
  const editRef = useRef<LineEdit | null>(null)
  const candlesRef = useRef<DemoCandle[]>([])
  const loadOlderRef = useRef<() => void>(() => undefined)

  const fastReady = displays.fastOrder && draft !== null && draft.orderType === 'limit'
  fastReadyRef.current = fastReady
  editRef.current = edit

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const linesMap = linesRef.current
    const chart = createChart(container, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: DEMO_CHART_COLORS.background },
        textColor: DEMO_CHART_COLORS.text,
      },
      grid: {
        vertLines: { color: DEMO_CHART_COLORS.grid },
        horzLines: { color: DEMO_CHART_COLORS.grid },
      },
      rightPriceScale: { borderColor: DEMO_CHART_COLORS.border },
      timeScale: { borderColor: DEMO_CHART_COLORS.border, timeVisible: true, secondsVisible: false },
    })
    const series = chart.addSeries(CandlestickSeries, {
      upColor: DEMO_CHART_COLORS.up,
      downColor: DEMO_CHART_COLORS.down,
      wickUpColor: DEMO_CHART_COLORS.up,
      wickDownColor: DEMO_CHART_COLORS.down,
      borderVisible: false,
    })
    chartRef.current = chart
    seriesRef.current = series
    markersRef.current = createSeriesMarkers(series, [])

    chart.subscribeClick((param) => {
      if (!fastReadyRef.current || !param.point) {
        setPopover(null)
        return
      }
      const price = series.coordinateToPrice(param.point.y)
      if (price === null || !Number.isFinite(price) || price <= 0) {
        setPopover(null)
        return
      }
      setFastError(null)
      setPopover({ x: param.point.x, y: param.point.y, price })
    })

    const timeScale = chart.timeScale()
    const handleRange = (range: { from: number } | null): void => {
      if (range && range.from < DEMO_CHART_LOAD_MORE_THRESHOLD) loadOlderRef.current()
    }
    timeScale.subscribeVisibleLogicalRangeChange(handleRange)

    const findLine = (y: number): DemoChartLine | null => {
      for (const line of linesDataRef.current) {
        if (!EDITABLE_KINDS.includes(line.kind)) continue
        const coordinate = series.priceToCoordinate(line.price)
        if (coordinate !== null && Math.abs(coordinate - y) <= DEMO_CHART_DRAG_HIT_PX) return line
      }
      return null
    }

    const setScroll = (enabled: boolean): void => {
      chart.applyOptions({ handleScroll: enabled, handleScale: enabled })
    }

    const handleDown = (event: MouseEvent): void => {
      if (editRef.current) return
      const y = event.clientY - container.getBoundingClientRect().top
      const line = findLine(y)
      if (!line) return
      event.stopPropagation()
      event.preventDefault()
      const { tradeId, kind } = parseDemoLineId(line.id)
      dragRef.current = { lineId: line.id, tradeId, kind, original: line.price, price: line.price, y }
      setScroll(false)
    }

    const handleMove = (event: MouseEvent): void => {
      const y = event.clientY - container.getBoundingClientRect().top
      const drag = dragRef.current
      if (!drag) {
        container.style.cursor = !editRef.current && findLine(y) ? 'ns-resize' : ''
        return
      }
      const price = series.coordinateToPrice(y)
      if (price === null || !Number.isFinite(price) || price <= 0) return
      drag.price = price
      drag.y = y
      linesRef.current.get(drag.lineId)?.applyOptions({ price })
    }

    const handleUp = (): void => {
      const drag = dragRef.current
      if (!drag) return
      dragRef.current = null
      setScroll(true)
      if (drag.price === drag.original) return
      setEditError(null)
      setEdit({ ...drag })
    }

    const handleKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      const active = dragRef.current ?? editRef.current
      if (!active) return
      dragRef.current = null
      setScroll(true)
      linesRef.current.get(active.lineId)?.applyOptions({ price: active.original })
      setEdit(null)
    }

    container.addEventListener('mousedown', handleDown, true)
    window.addEventListener('mousemove', handleMove)
    window.addEventListener('mouseup', handleUp)
    window.addEventListener('keydown', handleKey)

    return () => {
      container.removeEventListener('mousedown', handleDown, true)
      window.removeEventListener('mousemove', handleMove)
      window.removeEventListener('mouseup', handleUp)
      window.removeEventListener('keydown', handleKey)
      timeScale.unsubscribeVisibleLogicalRangeChange(handleRange)
      linesMap.clear()
      markersRef.current = null
      seriesRef.current = null
      chartRef.current = null
      chart.remove()
    }
  }, [])

  useEffect(() => {
    const series = seriesRef.current
    if (!series) return
    const linesMap = linesRef.current
    let cancelled = false
    let socket: WebSocket | null = null

    setFirstCandleTime(null)
    setEdit(null)
    dragRef.current = null
    candlesRef.current = []
    loadOlderRef.current = () => undefined
    linesMap.forEach((line) => series.removePriceLine(line))
    linesMap.clear()
    series.setData([])

    const klinesUrl = pair.market === 'futures' ? DEMO_FUTURES_KLINES_API_URL : DEMO_KLINES_API_URL
    const wsBase = pair.market === 'futures' ? DEMO_FUTURES_PRICE_WS_URL : DEMO_PRICE_WS_URL
    const url = `${klinesUrl}?symbol=${pair.symbol}&interval=${interval}&limit=${DEMO_CHART_CANDLE_LIMIT}`
    let isLoadingOlder = false
    let exhausted = false

    const parseRows = (rows: unknown): DemoCandle[] =>
      Array.isArray(rows) ? rows.map(parseDemoKlineRow).filter((item): item is DemoCandle => item !== null) : []

    loadOlderRef.current = () => {
      if (isLoadingOlder || exhausted || cancelled) return
      const request = resolveDemoOlderRequest({
        oldestTime: candlesRef.current[0]?.time ?? null,
        total: candlesRef.current.length,
        maxTotal: DEMO_CHART_MAX_CANDLES,
        pageLimit: DEMO_CHART_PAGE_LIMIT[pair.market],
      })
      if (!request) return
      isLoadingOlder = true
      const olderUrl = `${klinesUrl}?symbol=${pair.symbol}&interval=${interval}&limit=${request.limit}&endTime=${request.endTimeMs}`
      void (async () => {
        try {
          const res = await fetch(olderUrl)
          if (!res.ok || cancelled) return
          const older = parseRows(await res.json())
          if (cancelled) return
          if (older.length === 0) {
            exhausted = true
            return
          }
          const timeScale = chartRef.current?.timeScale()
          const before = timeScale?.getVisibleLogicalRange() ?? null
          const merged = mergeDemoCandles(older, candlesRef.current)
          const added = merged.length - candlesRef.current.length
          candlesRef.current = merged
          series.setData(merged.map(toChartCandle))
          if (before && timeScale && added > 0) {
            timeScale.setVisibleLogicalRange({ from: before.from + added, to: before.to + added })
          }
          setFirstCandleTime(merged[0].time)
        } catch {
          return
        } finally {
          isLoadingOlder = false
        }
      })()
    }

    const load = async (): Promise<void> => {
      try {
        const res = await fetch(url)
        if (!res.ok || cancelled) return
        const candles = parseRows(await res.json())
        if (cancelled || candles.length === 0) return
        candlesRef.current = candles
        precisionRef.current = resolveDemoChartPricePrecision(candles[candles.length - 1].close)
        series.applyOptions({
          priceFormat: {
            type: 'price',
            precision: precisionRef.current,
            minMove: 10 ** -precisionRef.current,
          },
        })
        series.setData(candles.map(toChartCandle))
        chartRef.current?.timeScale().fitContent()
        setFirstCandleTime(candles[0].time)

        socket = new WebSocket(`${wsBase}/${pair.symbol.toLowerCase()}@kline_${interval}`)
        socket.onmessage = (event): void => {
          try {
            const candle = parseDemoKlineMessage(JSON.parse(event.data))
            if (candle && !cancelled) {
              candlesRef.current = upsertDemoCandle(candlesRef.current, candle)
              series.update(toChartCandle(candle))
            }
          } catch {
            return
          }
        }
        socket.onerror = (): void => {
          return
        }
      } catch {
        return
      }
    }
    void load()

    return () => {
      cancelled = true
      socket?.close()
    }
  }, [pair.symbol, pair.market, interval])

  const lines = useMemo(
    () =>
      buildDemoChartLines({
        symbol: pair.symbol,
        positions,
        pending: pendingOrders,
        markPrice: livePrice,
        balance,
        displays,
      }),
    [pair.symbol, positions, pendingOrders, livePrice, balance, displays]
  )

  linesDataRef.current = lines

  useEffect(() => {
    const series = seriesRef.current
    if (!series) return
    const labels = d.chart.lineLabels
    const describe = (line: DemoChartLine): string => {
      const side = line.side === 'buy' ? d.chart.long : d.chart.short
      const size = formatQuantity(line.quantity)
      if (line.kind === 'position') {
        const pnl = line.pnl !== null ? formatSigned(line.pnl, DEMO_CHART_PNL_DECIMALS) : EMPTY_VALUE
        const roi = line.roi !== null ? `${formatSigned(line.roi)}%` : EMPTY_VALUE
        return fillTemplate(labels.position, { side, size, pnl, roi })
      }
      return fillTemplate(labels[line.kind], { side, size })
    }

    const existing = linesRef.current
    const wanted = new Set(lines.map((line) => line.id))
    existing.forEach((line, id) => {
      if (!wanted.has(id)) {
        series.removePriceLine(line)
        existing.delete(id)
      }
    })
    for (const line of lines) {
      const title = describe(line)
      const current = existing.get(line.id)
      const held = dragRef.current ?? editRef.current
      const price = held && held.lineId === line.id ? held.price : line.price
      if (current) {
        current.applyOptions({ price, title })
      } else {
        existing.set(
          line.id,
          series.createPriceLine({
            price,
            color: LINE_COLORS[line.kind],
            lineWidth: DEMO_CHART_LINE_WIDTH,
            lineStyle: LineStyle.Dashed,
            axisLabelVisible: true,
            title,
          })
        )
      }
    }
  }, [lines, d.chart, firstCandleTime, edit])

  useEffect(() => {
    const markers = markersRef.current
    if (!markers) return
    if (!displays.transactionHistory) {
      markers.setMarkers([])
      return
    }
    markers.setMarkers(
      buildDemoChartMarkers({
        symbol: pair.symbol,
        trades: tradedOrders,
        interval,
        firstCandleTime,
      }).map((marker) => ({
        time: marker.time as UTCTimestamp,
        position: marker.side === 'buy' ? ('belowBar' as const) : ('aboveBar' as const),
        shape: marker.side === 'buy' ? ('arrowUp' as const) : ('arrowDown' as const),
        color: marker.side === 'buy' ? DEMO_CHART_COLORS.buyMarker : DEMO_CHART_COLORS.sellMarker,
        text: marker.side === 'buy' ? d.chart.markerBuy : d.chart.markerSell,
      }))
    )
  }, [tradedOrders, pair.symbol, interval, firstCandleTime, displays.transactionHistory, d.chart])

  useEffect(() => {
    if (!fastReady) setPopover(null)
  }, [fastReady])

  useEffect(() => {
    setPopover(null)
  }, [pair.symbol])

  const fastSize =
    popover && draft
      ? resolveDemoFastOrderSize({
          mode: draft.sizeMode,
          size: draft.size,
          percent: draft.percent,
          available: balance,
          leverage: draft.leverage,
          price: popover.price,
        })
      : null

  const editTrade = edit
    ? ([...positions, ...pendingOrders].find((item) => item.id === edit.tradeId) ?? null)
    : null
  const editPatch = edit ? buildDemoLineEdit(edit.kind, edit.price) : null
  const editInvalid =
    editTrade && editPatch
      ? validateDemoTradeEdit(editTrade, editPatch, livePrice, resolveDemoTradeLiquidation(editTrade, balance ?? 0))
      : null
  const codeMessages: Record<string, string> = d.errors.codes

  const cancelEdit = (): void => {
    if (edit) linesRef.current.get(edit.lineId)?.applyOptions({ price: edit.original })
    setEdit(null)
  }

  const confirmEdit = async (): Promise<void> => {
    if (!edit || !editPatch || editInvalid) return
    setIsSavingEdit(true)
    const code = await onUpdateOrder(edit.tradeId, editPatch)
    setIsSavingEdit(false)
    if (code) {
      setEditError(codeMessages[code] ?? d.errors.orderFailed)
      return
    }
    setEdit(null)
  }

  const placeFast = async (side: 'buy' | 'sell'): Promise<void> => {
    if (!popover || !draft) return
    if (!fastSize) {
      setFastError(d.errors.sizeInvalid)
      return
    }
    setIsPlacing(true)
    const code = await onFastOrder({
      leverage: draft.leverage,
      marginMode: draft.marginMode,
      sizeMode: draft.sizeMode,
      takeProfit: draft.takeProfit,
      stopLoss: draft.stopLoss,
      size: fastSize.size,
      symbol: pair.symbol,
      side,
      orderType: 'limit',
      price: Number(popover.price.toFixed(precisionRef.current)),
    })
    setIsPlacing(false)
    if (code) {
      const codes: Record<string, string> = d.errors.codes
      setFastError(codes[code] ?? d.errors.orderFailed)
      return
    }
    setPopover(null)
  }

  return (
    <div className="flex flex-col h-full min-h-0 bg-background-dark">
      <div className="flex items-center justify-between gap-2 px-3 py-1.5 border-b border-primary/10 shrink-0">
        <div className="flex items-center gap-1 overflow-x-auto" role="group" aria-label={d.chart.interval}>
          {DEMO_CHART_INTERVALS.map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setIntervalValue(item)}
              aria-pressed={interval === item}
              className={`px-2 py-1 text-[11px] font-bold rounded transition-colors ${
                interval === item ? 'bg-primary/15 text-primary' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {item}
            </button>
          ))}
        </div>
        <OtherDisplays displays={displays} onToggle={toggleDisplay} />
      </div>
      <div className="relative flex-1 min-h-0">
        <div ref={containerRef} className="absolute inset-0" data-testid="demo-chart" />
        {edit && (
          <div
            className="absolute z-20 w-60 rounded-lg border border-primary/30 bg-[#202630] p-3 shadow-2xl space-y-2"
            style={{ left: 12, top: Math.min(Math.max(8, edit.y + 8), 200) }}
          >
            <div className="text-[11px] text-slate-300">
              {fillTemplate(d.chart.editConfirm, {
                kind: d.chart.editKinds[edit.kind as 'takeProfit' | 'stopLoss' | 'order'],
                price: edit.price.toFixed(precisionRef.current),
              })}
            </div>
            {(editInvalid || editError) && (
              <p className="text-[11px] text-rose-400 font-bold break-words">
                {editInvalid ? (codeMessages[editInvalid] ?? d.errors.orderFailed) : editError}
              </p>
            )}
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                disabled={isSavingEdit || editInvalid !== null}
                onClick={() => void confirmEdit()}
                className="py-1.5 text-xs font-bold rounded bg-primary text-white hover:opacity-90 disabled:opacity-50"
              >
                {d.chart.confirm}
              </button>
              <button
                type="button"
                onClick={cancelEdit}
                className="py-1.5 text-xs font-bold rounded bg-slate-800 text-slate-300 hover:text-white"
              >
                {d.cancel}
              </button>
            </div>
          </div>
        )}
        {popover && fastReady && (
          <div
            className="absolute z-20 w-52 rounded-lg border border-primary/30 bg-[#202630] p-3 shadow-2xl space-y-2"
            style={{ left: Math.max(8, popover.x - 104), top: Math.max(8, popover.y + 8) }}
          >
            <div className="text-[11px] text-slate-300">
              {fillTemplate(d.chart.fastOrder.atPrice, {
                price: popover.price.toFixed(precisionRef.current),
              })}
            </div>
            <div className="text-[11px] font-mono text-slate-400">
              {fastSize
                ? fillTemplate(d.chart.fastOrder.sizePreview, {
                    quantity: formatQuantity(fastSize.sizing.quantity),
                    asset: pair.baseAsset,
                    cost: formatAmount(fastSize.sizing.margin, 2),
                  })
                : d.errors.sizeInvalid}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                disabled={isPlacing}
                onClick={() => void placeFast('buy')}
                className="py-1.5 text-xs font-bold rounded bg-emerald-500 text-white hover:bg-emerald-600 disabled:opacity-50"
              >
                {d.chart.fastOrder.buyLong}
              </button>
              <button
                type="button"
                disabled={isPlacing}
                onClick={() => void placeFast('sell')}
                className="py-1.5 text-xs font-bold rounded bg-rose-500 text-white hover:bg-rose-600 disabled:opacity-50"
              >
                {d.chart.fastOrder.sellShort}
              </button>
            </div>
            <button
              type="button"
              onClick={() => setPopover(null)}
              className="w-full text-[11px] text-slate-400 hover:text-slate-200"
            >
              {d.chart.fastOrder.dismiss}
            </button>
            {fastError && <p className="text-[11px] text-rose-400 font-bold break-words">{fastError}</p>}
          </div>
        )}
      </div>
    </div>
  )
}
