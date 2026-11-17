import { ExchangeLogo } from '@/components/ui/ExchangeLogo'
import { getExchangeBrand } from '@/lib/exchangeBranding'
import type { LandingCopy } from '@/lib/content/landing'

const PANEL =
  'rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-primary/20 dark:bg-background-dark sm:p-6'

type FeeTableProps = {
  copy: LandingCopy['fees']
}

export function FeeTable({ copy }: FeeTableProps): React.JSX.Element {
  return (
    <div className={PANEL}>
      <h3 className="text-base font-bold text-slate-900 dark:text-white">{copy.label}</h3>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[22rem] text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs font-medium text-slate-500 dark:border-neutral-border">
              <th scope="col" className="pb-2 font-medium">{copy.exchangeHead}</th>
              <th scope="col" className="pb-2 text-right font-medium">{copy.feesHead}</th>
              <th scope="col" className="pb-2 text-right font-medium">{copy.volumeHead}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-neutral-border/60">
            {copy.rows.map((row) => (
              <tr key={row.exchange}>
                <th scope="row" className="py-3 text-left font-semibold text-slate-900 dark:text-white">
                  <span className="flex items-center gap-3">
                    <ExchangeLogo exchange={row.exchange} size={24} />
                    {getExchangeBrand(row.exchange)?.name ?? row.exchange}
                  </span>
                </th>
                <td className="py-3 text-right tabular-nums text-slate-700 dark:text-slate-300">{row.fees}</td>
                <td className="py-3 text-right tabular-nums text-slate-700 dark:text-slate-300">{row.volume}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

type AssistantPreviewProps = {
  copy: LandingCopy['assistant']
}

export function AssistantPreview({ copy }: AssistantPreviewProps): React.JSX.Element {
  return (
    <div className={PANEL}>
      <div className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-white">
        <span aria-hidden="true" className="material-symbols-outlined text-xl text-primary dark:text-accent">
          smart_toy
        </span>
        {copy.label}
      </div>
      <div className="mt-5 flex flex-col gap-4">
        <p className="ml-auto max-w-[85%] rounded-xl rounded-br-sm bg-primary px-4 py-3 text-sm leading-relaxed text-white">
          {copy.question}
        </p>
        <div className="max-w-[92%] space-y-2 rounded-xl rounded-bl-sm bg-slate-100 px-4 py-3 text-sm leading-relaxed text-slate-800 dark:bg-neutral-dark dark:text-slate-200">
          {copy.answerLines.map((line) => (
            <p key={line}>{line}</p>
          ))}
          <p className="pt-1 text-xs text-slate-500">{copy.sources}</p>
        </div>
      </div>
    </div>
  )
}
