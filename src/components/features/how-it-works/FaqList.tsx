import { FAQ_ITEMS } from '@/lib/content/howItWorks'

export function FaqList(): React.JSX.Element {
  return (
    <div className="divide-y divide-neutral-border border-y border-neutral-border">
      {FAQ_ITEMS.map((item) => (
        <details key={item.question} className="group py-1">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-4 rounded-lg px-1 py-4 text-left font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent [&::-webkit-details-marker]:hidden">
            <span>{item.question}</span>
            <span
              aria-hidden="true"
              className="material-symbols-outlined shrink-0 text-slate-400 transition-transform duration-200 ease-out group-open:rotate-180"
            >
              expand_more
            </span>
          </summary>
          <p className="max-w-[68ch] px-1 pb-4 leading-relaxed text-slate-300">{item.answer}</p>
        </details>
      ))}
    </div>
  )
}
