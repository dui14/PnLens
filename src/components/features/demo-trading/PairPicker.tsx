'use client'

import { useEffect, useRef, useState } from 'react'
import { useT } from '@/lib/i18n/client'
import {
  DEMO_MARKET_PAIRS,
  DEMO_PAIR_CATEGORIES,
  type DemoMarketPair,
  type DemoPairCategory,
} from '@/lib/config/demoTrading'
import { formatChangePercent, formatPrice, pnlTone } from './demoFormat'

type PairPickerProps = {
  selected: DemoMarketPair
  prices: Record<string, number>
  changes: Record<string, number>
  onSelect: (symbol: string) => void
}

export function PairPicker({ selected, prices, changes, onSelect }: PairPickerProps): React.JSX.Element {
  const { t } = useT()
  const d = t.demo
  const [isOpen, setIsOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<DemoPairCategory | 'all'>('all')
  const rootRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!isOpen) return
    const handleClickOutside = (event: MouseEvent): void => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isOpen])

  const keyword = search.trim().toLowerCase()
  const pairs = DEMO_MARKET_PAIRS.filter(
    (pair) =>
      (filter === 'all' || pair.category === filter) &&
      (!keyword ||
      pair.label.toLowerCase().includes(keyword) ||
      pair.baseAsset.toLowerCase().includes(keyword))
  )

  return (
    <div ref={rootRef} className="relative flex items-center gap-2">
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        aria-expanded={isOpen}
        className="group inline-flex items-center gap-1 rounded-md border border-primary/20 px-2 py-1 hover:border-primary/40 hover:bg-primary/5 transition-colors"
      >
        <span className="font-bold text-base md:text-lg leading-none">
          {selected.label.replace('/', ' / ')}
        </span>
        <span className="material-symbols-outlined text-base text-slate-400 group-hover:text-primary">
          {isOpen ? 'expand_less' : 'expand_more'}
        </span>
      </button>
      <span className="text-xs px-2 py-0.5 rounded bg-accent text-background-dark font-bold uppercase">
        Demo
      </span>

      {isOpen && (
        <div className="absolute left-0 top-[calc(100%+8px)] z-40 w-[420px] max-w-[calc(100vw-2rem)] min-w-[280px] rounded-lg border border-primary/20 bg-[#202630] shadow-2xl">
          <div className="p-4 pb-2">
            <div className="relative">
              <span className="material-symbols-outlined absolute left-2 top-1.5 text-slate-500 text-lg">
                search
              </span>
              <input
                type="text"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={d.search}
                autoFocus
                className="w-full bg-slate-800/50 border border-primary/20 rounded-lg pl-8 py-1.5 text-xs focus:ring-1 focus:ring-primary outline-none"
              />
            </div>
          </div>

          <div className="px-4 pb-2 flex gap-1 overflow-x-auto" role="group" aria-label={d.contract}>
            {(['all', ...DEMO_PAIR_CATEGORIES] as const).map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => setFilter(item)}
                aria-pressed={filter === item}
                className={`px-2.5 py-1 text-[11px] font-bold rounded whitespace-nowrap transition-colors ${
                  filter === item ? 'bg-primary/15 text-primary' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {item === 'all' ? d.filterAll : d.pairCategories[item]}
              </button>
            ))}
          </div>

          <div className="px-4 pb-3">
            <div className="grid grid-cols-[1.6fr_1fr] text-[11px] text-slate-500 border-b border-primary/10 pb-2">
              <span>{d.contract}</span>
              <span className="text-right">{d.lastPrice}</span>
            </div>

            <div className="max-h-72 overflow-y-auto">
              {pairs.length === 0 && (
                <div className="py-6 text-center text-xs text-slate-500">{d.noPairs}</div>
              )}
              {DEMO_PAIR_CATEGORIES.map((category) => {
                const categoryPairs = pairs.filter((pair) => pair.category === category)
                if (categoryPairs.length === 0) return null
                return (
                  <div key={category}>
                    <div className="px-2 pt-3 pb-1 text-[10px] uppercase font-bold text-slate-500">
                      {d.pairCategories[category]}
                    </div>
                    {categoryPairs.map((pair) => (
                        <button
                          key={pair.symbol}
                          type="button"
                          onClick={() => {
                            onSelect(pair.symbol)
                            setIsOpen(false)
                            setSearch('')
                          }}
                          className={`w-full grid grid-cols-[1.6fr_1fr] items-center gap-2 px-2 py-2 text-left text-xs border-b border-primary/5 transition-colors ${
                            selected.symbol === pair.symbol ? 'bg-primary/10' : 'hover:bg-primary/5'
                          }`}
                        >
                          <div className="min-w-0">
                            <div className="font-semibold text-slate-200 truncate">{pair.symbol}</div>
                            <div className="text-[10px] text-slate-500">{pair.market === 'spot' ? d.spotMarket : d.perpetual}</div>
                          </div>
                          <div className="text-right font-mono">
                        <div className="text-slate-200">{formatPrice(prices[pair.symbol])}</div>
                        <div className={`text-[10px] ${pnlTone(changes[pair.symbol])}`}>
                          {formatChangePercent(changes[pair.symbol])}
                        </div>
                      </div>
                        </button>
                    ))}
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
