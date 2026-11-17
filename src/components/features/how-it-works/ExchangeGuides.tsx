import Image from 'next/image'
import { getExchangeBrand } from '@/lib/exchangeBranding'
import {
  CREDENTIALS_TABLE,
  EXCHANGE_GUIDES,
  KEY_PAIR_GUIDE,
  PAGE_CHROME,
  getHistoryDays,
} from '@/lib/content/howItWorks'

const KEY_PAIR_ID = 'key-pair'
const LOGO_SIZE = 24

function CodeBlock({ label, lines }: { label: string; lines: readonly string[] }): React.JSX.Element {
  return (
    <div>
      <p className="mb-2 text-sm font-semibold text-slate-200">{label}</p>
      <pre className="overflow-x-auto rounded-lg border border-neutral-border bg-background-dark p-4 font-mono text-[13px] leading-relaxed text-accent">
        <code>{lines.join('\n')}</code>
      </pre>
    </div>
  )
}

export function CredentialsTable(): React.JSX.Element {
  return (
    <div className="overflow-x-auto rounded-xl border border-neutral-border">
      <table className="w-full min-w-[30rem] text-left text-sm">
        <caption className="sr-only">{PAGE_CHROME.tableCaption}</caption>
        <thead className="bg-panel-dark text-slate-300">
          <tr>
            <th scope="col" className="px-4 py-3 font-semibold">{CREDENTIALS_TABLE.head.exchange}</th>
            <th scope="col" className="px-4 py-3 font-semibold">{CREDENTIALS_TABLE.head.fields}</th>
            <th scope="col" className="px-4 py-3 text-right font-semibold">{CREDENTIALS_TABLE.head.history}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-border">
          {EXCHANGE_GUIDES.map((guide) => {
            const brand = getExchangeBrand(guide.exchange)
            return (
              <tr key={guide.exchange}>
                <th scope="row" className="px-4 py-3 font-semibold text-white">
                  {brand?.name ?? guide.exchange}
                </th>
                <td className="px-4 py-3 text-slate-300">{guide.fields.join(' + ')}</td>
                <td className="px-4 py-3 text-right tabular-nums text-slate-300">
                  {getHistoryDays(guide.exchange)} days
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

export function ExchangeGuides(): React.JSX.Element {
  return (
    <div className="space-y-3">
      {EXCHANGE_GUIDES.map((guide) => {
        const brand = getExchangeBrand(guide.exchange)
        return (
          <details
            key={guide.exchange}
            className="group rounded-xl border border-neutral-border bg-panel-dark"
          >
            <summary className="flex cursor-pointer list-none items-center gap-3 rounded-xl px-4 py-3 font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent [&::-webkit-details-marker]:hidden">
              {brand && (
                <Image
                  src={brand.logo}
                  alt=""
                  width={LOGO_SIZE}
                  height={LOGO_SIZE}
                  className="size-6 rounded object-contain"
                />
              )}
              <span className="flex-1">{brand?.name ?? guide.exchange}</span>
              <span className="hidden text-sm font-normal text-slate-400 sm:inline">
                {guide.fields.join(' + ')}
              </span>
              <span
                aria-hidden="true"
                className="material-symbols-outlined text-slate-400 transition-transform duration-200 ease-out group-open:rotate-180"
              >
                expand_more
              </span>
            </summary>
            <div className="border-t border-neutral-border px-4 pb-5 pt-4">
              <ol className="list-decimal space-y-2 pl-5 leading-relaxed text-slate-300 marker:text-slate-500">
                {guide.steps.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
              {guide.note && <p className="mt-4 text-sm text-slate-400">{guide.note}</p>}
              {guide.keyPair && (
                <p className="mt-4 text-sm">
                  <a
                    href={`#${KEY_PAIR_ID}`}
                    className="rounded font-semibold text-accent underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  >
                    {PAGE_CHROME.keyPairLink}
                  </a>
                </p>
              )}
            </div>
          </details>
        )
      })}
    </div>
  )
}

export function KeyPairGuide(): React.JSX.Element {
  return (
    <div id={KEY_PAIR_ID} className="scroll-mt-24 space-y-4 rounded-xl border border-neutral-border bg-panel-dark p-5">
      <h4 className="text-lg font-bold text-white">{KEY_PAIR_GUIDE.title}</h4>
      <p className="max-w-[68ch] leading-relaxed text-slate-300">{KEY_PAIR_GUIDE.intro}</p>
      <CodeBlock
        label={KEY_PAIR_GUIDE.commands.ed25519.label}
        lines={KEY_PAIR_GUIDE.commands.ed25519.lines}
      />
      <CodeBlock label={KEY_PAIR_GUIDE.commands.rsa.label} lines={KEY_PAIR_GUIDE.commands.rsa.lines} />
      <p className="max-w-[68ch] text-sm leading-relaxed text-slate-400">{KEY_PAIR_GUIDE.outro}</p>
    </div>
  )
}
