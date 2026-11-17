'use client'

import { useState, useMemo } from 'react'
import { useT } from '@/lib/i18n/client'
import { fillTemplate } from '@/lib/i18n/format'
import type { PNLCalendarDay, PnlSnapshotCalendar } from '@/lib/types'
import { earliestCalendarYear, zeroFillMonthDays, zeroFillYearMonths } from '@/lib/pnl/snapshotView'
import { mondayIndex, toDayKey, vietnamDateParts } from '@/lib/time/dayBoundary'

type CalendarView = 'daily' | 'monthly'

function IconLeft(): React.JSX.Element {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M8.83887 10.5957C9.03413 10.4005 9.03413 10.0839 8.83887 9.88863L4.94978 5.99955L8.83887 2.11046C9.03413 1.9152 9.03413 1.59862 8.83887 1.40335C8.64361 1.20809 8.32702 1.20809 8.13176 1.40335L3.88912 5.64599C3.69386 5.84126 3.69386 6.15784 3.88912 6.3531L8.13176 10.5957C8.32702 10.791 8.64361 10.791 8.83887 10.5957Z"
      />
    </svg>
  )
}

function IconRight(): React.JSX.Element {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M3.16113 10.5957C2.96587 10.4005 2.96587 10.0839 3.16113 9.88863L7.05022 5.99955L3.16113 2.11046C2.96587 1.9152 2.96587 1.59862 3.16113 1.40335C3.35639 1.20809 3.67298 1.20809 3.86824 1.40335L8.11088 5.64599C8.30614 5.84126 8.30614 6.15784 8.11088 6.3531L3.86824 10.5957C3.67298 10.791 3.35639 10.791 3.16113 10.5957Z"
      />
    </svg>
  )
}

function formatPNL(pnl: number, compact = false): string {
  const abs = Math.abs(pnl)

  if (compact) {
    const digits = abs >= 100 ? 0 : abs >= 1 ? 2 : 4
    const value = abs.toFixed(digits)
    if (pnl > 0) return `+${value}`
    if (pnl < 0) return `-${value}`
    return '0'
  }

  const full = abs.toFixed(4)
  if (pnl > 0) return `+${full} USDT`
  if (pnl < 0) return `-${full} USDT`
  return `0.0000 USDT`
}

function pnlColor(pnl: number, hasData: boolean): string {
  if (!hasData) return 'text-slate-600'
  if (pnl > 0) return 'text-emerald-400'
  if (pnl < 0) return 'text-rose-400'
  return 'text-slate-400'
}

type PNLCalendarProps = {
  calendar: PnlSnapshotCalendar
}

export function PNLCalendar({ calendar }: PNLCalendarProps): React.JSX.Element {
  const { t } = useT()
  const cal = t.calendar
  const opened = vietnamDateParts(new Date())
  const [view, setView] = useState<CalendarView>('daily')
  const [year, setYear] = useState(opened.year)
  const [month, setMonth] = useState(opened.month)
  const days = useMemo(() => zeroFillMonthDays(calendar.days, year, month), [calendar.days, year, month])
  const months = useMemo(() => zeroFillYearMonths(calendar.months, year), [calendar.months, year])
  const yearOptions = useMemo(() => {
    const currentYear = vietnamDateParts(new Date()).year
    const firstYear = earliestCalendarYear(calendar.months, currentYear)
    const options: number[] = []

    for (let y = currentYear; y >= firstYear; y -= 1) {
      options.push(y)
    }

    return options
  }, [calendar.months])

  const buildRows = (): Array<PNLCalendarDay | null>[] => {
    const startDayOfWeek = mondayIndex(year, month, 1)
    const cells: Array<PNLCalendarDay | null> = [
      ...Array(startDayOfWeek).fill(null),
      ...days,
    ]
    while (cells.length % 7 !== 0) cells.push(null)
    const rows: Array<PNLCalendarDay | null>[] = []
    for (let i = 0; i < cells.length; i += 7) {
      rows.push(cells.slice(i, i + 7))
    }
    return rows
  }

  const isPastOrToday = (dateStr: string): boolean => {
    const today = toDayKey(new Date()) ?? ''
    return dateStr <= today
  }

  const isPastMonth = (m: number): boolean => {
    const today = vietnamDateParts(new Date())
    return year < today.year || (year === today.year && m <= today.month)
  }

  const isAtCurrentPeriod = (): boolean => {
    const today = vietnamDateParts(new Date())
    if (view === 'daily') return year === today.year && month === today.month
    return year === today.year
  }

  const goBack = (): void => {
    if (view === 'daily') {
      if (month === 1) {
        setMonth(12)
        setYear((y) => y - 1)
      } else {
        setMonth((m) => m - 1)
      }
    } else {
      setYear((y) => y - 1)
    }
  }

  const goForward = (): void => {
    if (isAtCurrentPeriod()) return
    if (view === 'daily') {
      if (month === 12) {
        setMonth(1)
        setYear((y) => y + 1)
      } else {
        setMonth((m) => m + 1)
      }
    } else {
      setYear((y) => y + 1)
    }
  }

  const handleViewChange = (v: CalendarView): void => {
    setView(v)
    if (v === 'daily' && month === 0) setMonth(vietnamDateParts(new Date()).month)
  }

  const handleMonthSelectChange = (event: React.ChangeEvent<HTMLSelectElement>): void => {
    const selectedMonth = Number(event.target.value)
    const today = vietnamDateParts(new Date())
    const currentYear = today.year
    const currentMonth = today.month

    if (year === currentYear && selectedMonth > currentMonth) {
      setMonth(currentMonth)
      return
    }

    setMonth(selectedMonth)
  }

  const handleYearSelectChange = (event: React.ChangeEvent<HTMLSelectElement>): void => {
    const selectedYear = Number(event.target.value)
    const today = vietnamDateParts(new Date())
    const currentYear = today.year
    const currentMonth = today.month

    if (view === 'monthly') {
      setYear(Math.min(selectedYear, currentYear))
      return
    }

    if (selectedYear > currentYear) {
      setYear(currentYear)
      setMonth(currentMonth)
      return
    }

    setYear(selectedYear)

    if (selectedYear === currentYear && month > currentMonth) {
      setMonth(currentMonth)
    }
  }

  const handlePeriodWheel = (event: React.WheelEvent<HTMLDivElement>): void => {
    event.preventDefault()

    if (event.deltaY > 0) {
      goForward()
      return
    }

    goBack()
  }

  const calendarRows = view === 'daily' ? buildRows() : []

  return (
    <div className="bg-background-light dark:bg-background-dark p-4 sm:p-6 rounded-xl border border-slate-200 dark:border-primary/20 shadow-sm relative">
      <div className="flex flex-col gap-3 mb-5">
        <div className="w-full overflow-x-auto">
          <div className="inline-flex gap-2">
            <button
              onClick={() => handleViewChange('daily')}
              className={`px-3 py-1.5 text-xs font-bold rounded-full transition-colors shrink-0 ${
                view === 'daily'
                  ? 'bg-primary/20 text-primary border border-primary/40'
                  : 'text-slate-500 hover:text-slate-300 border border-transparent'
              }`}
            >
              {cal.daily}
            </button>
            <button
              onClick={() => handleViewChange('monthly')}
              className={`px-3 py-1.5 text-xs font-bold rounded-full transition-colors shrink-0 ${
                view === 'monthly'
                  ? 'bg-primary/20 text-primary border border-primary/40'
                  : 'text-slate-500 hover:text-slate-300 border border-transparent'
              }`}
            >
              {cal.monthly}
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3" onWheel={handlePeriodWheel}>
          <button
            onClick={goBack}
            className="p-1.5 rounded hover:bg-primary/10 text-slate-400 hover:text-primary transition-colors"
            aria-label={cal.previous}
          >
            <IconLeft />
          </button>
          <span className="text-sm font-bold min-w-[110px] text-center flex-1">
            {view === 'daily'
              ? `${cal.months[month - 1]} ${year}`
              : fillTemplate(cal.yearLabel, { year })}
          </span>
          <button
            onClick={goForward}
            disabled={isAtCurrentPeriod()}
            className="p-1.5 rounded hover:bg-primary/10 text-slate-400 hover:text-primary transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            aria-label={cal.next}
          >
            <IconRight />
          </button>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {view === 'daily' && (
            <select
              value={month}
              onChange={handleMonthSelectChange}
              className="h-8 rounded-lg border border-slate-200 dark:border-primary/20 bg-white dark:bg-background-dark px-2 text-xs font-semibold text-slate-700 dark:text-slate-200 min-w-[110px]"
            >
              {cal.months.map((label, index) => {
                const optionMonth = index + 1
                return (
                  <option key={label} value={optionMonth}>
                    {label}
                  </option>
                )
              })}
            </select>
          )}

          <select
            value={year}
            onChange={handleYearSelectChange}
            className="h-8 rounded-lg border border-slate-200 dark:border-primary/20 bg-white dark:bg-background-dark px-2 text-xs font-semibold text-slate-700 dark:text-slate-200 min-w-[90px]"
          >
            {yearOptions.map((optionYear) => (
              <option key={optionYear} value={optionYear}>
                {optionYear}
              </option>
            ))}
          </select>
        </div>
      </div>

      {view === 'daily' && (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse table-fixed min-w-[280px]">
            <thead>
              <tr>
                {cal.weekdays.map((h) => (
                  <th
                    key={h}
                    className="py-2 px-1 text-[10px] sm:text-[11px] text-slate-500 font-bold text-center"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {calendarRows.map((row, ri) => (
                <tr key={ri}>
                  {row.map((cell, ci) => {
                    if (!cell) {
                      return (
                        <td
                          key={ci}
                          className="border border-primary/5 bg-slate-900/20 h-12 sm:h-14 w-[14.28%]"
                        />
                      )
                    }
                    const active = isPastOrToday(cell.date)
                    const dayNum = parseInt(cell.date.split('-')[2], 10)
                    const hasData = active && cell.tradeCount > 0
                    return (
                      <td
                        key={ci}
                        className={`border border-primary/5 h-12 sm:h-14 w-[14.28%] align-top p-1 ${
                          active
                            ? hasData
                              ? cell.pnl > 0
                                ? 'bg-emerald-500/5 hover:bg-emerald-500/10'
                                : cell.pnl < 0
                                  ? 'bg-rose-500/5 hover:bg-rose-500/10'
                                  : 'bg-panel-dark/30 hover:bg-panel-dark/50'
                              : 'bg-panel-dark/20 hover:bg-panel-dark/40'
                            : 'bg-slate-900/10'
                        } transition-colors`}
                      >
                        <p className="text-[10px] sm:text-[11px] font-bold text-slate-400 leading-none mb-1">
                          {dayNum}
                        </p>
                        {active ? (
                          <span className={`text-[9px] sm:text-[10px] font-mono font-bold leading-tight ${pnlColor(cell.pnl, hasData)}`}>
                            {hasData ? formatPNL(cell.pnl, true) : '0'}
                          </span>
                        ) : (
                          <span className="text-[9px] sm:text-[10px] text-slate-600">--</span>
                        )}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {view === 'monthly' && (
        <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
          {months.map((m) => {
            const active = isPastMonth(m.month)
            const hasData = active && m.tradeCount > 0
            return (
              <div
                key={m.month}
                className={`p-3 rounded-lg border text-center transition-colors ${
                  active
                    ? hasData
                      ? m.pnl > 0
                        ? 'border-emerald-500/20 bg-emerald-500/5'
                        : m.pnl < 0
                          ? 'border-rose-500/20 bg-rose-500/5'
                          : 'border-primary/15 bg-panel-dark/30'
                      : 'border-primary/10 bg-panel-dark/20'
                    : 'border-primary/5 bg-slate-900/10'
                }`}
              >
                <p className="text-[11px] text-slate-500 font-bold mb-2">
                  {cal.months[m.month - 1]}
                </p>
                {active ? (
                  <>
                    <span className={`text-xs font-mono font-bold ${pnlColor(m.pnl, hasData)}`}>
                      {hasData ? formatPNL(m.pnl) : '0.0000 USDT'}
                    </span>
                    {m.tradeCount > 0 && (
                      <p className="text-[10px] text-slate-600 mt-1">{fillTemplate(cal.trades, { count: m.tradeCount })}</p>
                    )}
                  </>
                ) : (
                  <span className="text-xs text-slate-600">--</span>
                )}
              </div>
            )
          })}
        </div>
      )}

    </div>
  )
}
