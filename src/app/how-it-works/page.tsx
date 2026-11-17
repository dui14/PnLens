import type { Metadata } from 'next'
import { GuideHeader } from '@/components/features/how-it-works/GuideHeader'
import { FaqList } from '@/components/features/how-it-works/FaqList'
import {
  CredentialsTable,
  ExchangeGuides,
  KeyPairGuide,
} from '@/components/features/how-it-works/ExchangeGuides'
import {
  CREDENTIALS_TABLE,
  GUIDE_SECTIONS,
  HOW_IT_WORKS_HERO,
  HOW_IT_WORKS_META,
  OVERVIEW,
  PAGE_CHROME,
  SECURITY,
  SETUP_STEPS,
} from '@/lib/content/howItWorks'

export const metadata: Metadata = {
  title: HOW_IT_WORKS_META.title,
  description: HOW_IT_WORKS_META.description,
}

const KEY_STEP_ID = 'key'

export default function HowItWorksPage(): React.JSX.Element {
  return (
    <div className="min-h-screen bg-background-dark text-slate-300 selection:bg-primary/60 selection:text-white">
      <GuideHeader />
      <div className="mx-auto max-w-6xl px-4 pb-24 pt-12 sm:px-6 lg:grid lg:grid-cols-[14rem_minmax(0,1fr)] lg:gap-16">
        <aside className="hidden lg:block">
          <nav aria-label={PAGE_CHROME.tocLabel} className="sticky top-28">
            <p className="mb-3 text-sm font-semibold text-white">{PAGE_CHROME.tocLabel}</p>
            <ul className="space-y-1 border-l border-neutral-border">
              {GUIDE_SECTIONS.map((section) => (
                <li key={section.id}>
                  <a
                    href={`#${section.id}`}
                    className="-ml-px block border-l border-transparent py-1.5 pl-4 text-sm text-slate-400 transition-colors hover:border-accent hover:text-white focus-visible:text-white focus-visible:outline-none"
                  >
                    {section.title}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        </aside>

        <main className="min-w-0 max-w-3xl">
          <h1 className="text-4xl font-extrabold tracking-tight text-white sm:text-5xl">
            {HOW_IT_WORKS_HERO.title}
          </h1>
          <p className="mt-5 max-w-[62ch] text-lg leading-relaxed text-slate-300">
            {HOW_IT_WORKS_HERO.lead}
          </p>

          <section id="overview" className="scroll-mt-24 pt-16">
            <h2 className="text-2xl font-bold tracking-tight text-white">{OVERVIEW.title}</h2>
            <p className="mt-3 max-w-[68ch] leading-relaxed">{OVERVIEW.intro}</p>
            <ul className="mt-5 max-w-[68ch] list-disc space-y-2 pl-5 leading-relaxed marker:text-primary">
              {OVERVIEW.points.map((point) => (
                <li key={point}>{point}</li>
              ))}
            </ul>
          </section>

          <section id="steps" className="scroll-mt-24 pt-16">
            <h2 className="text-2xl font-bold tracking-tight text-white">
              {GUIDE_SECTIONS[1].title}
            </h2>
            <ol className="mt-8 space-y-12">
              {SETUP_STEPS.map((step, index) => (
                <li
                  key={step.id}
                  className="grid grid-cols-[2.5rem_minmax(0,1fr)] gap-x-4 sm:grid-cols-[3rem_minmax(0,1fr)]"
                >
                  <span
                    aria-hidden="true"
                    className="flex size-10 items-center justify-center rounded-full bg-primary text-base font-bold tabular-nums text-white sm:size-12 sm:text-lg"
                  >
                    {index + 1}
                  </span>
                  <div className="min-w-0 pt-1.5">
                    <h3 className="text-xl font-bold text-white">{step.title}</h3>
                    <div className="mt-3 max-w-[68ch] space-y-3 leading-relaxed">
                      {step.body.map((paragraph) => (
                        <p key={paragraph}>{paragraph}</p>
                      ))}
                    </div>
                    {step.id === KEY_STEP_ID && (
                      <div className="mt-6 space-y-6">
                        <div>
                          <h4 className="mb-3 text-base font-semibold text-white">
                            {CREDENTIALS_TABLE.title}
                          </h4>
                          <CredentialsTable />
                        </div>
                        <ExchangeGuides />
                        <KeyPairGuide />
                      </div>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          </section>

          <section id="security" className="scroll-mt-24 pt-16">
            <h2 className="text-2xl font-bold tracking-tight text-white">{SECURITY.title}</h2>
            <p className="mt-3 max-w-[68ch] leading-relaxed">{SECURITY.intro}</p>
            <dl className="mt-6 divide-y divide-neutral-border border-y border-neutral-border">
              {SECURITY.points.map((point) => (
                <div
                  key={point.title}
                  className="grid gap-1 py-4 sm:grid-cols-[12rem_minmax(0,1fr)] sm:gap-6"
                >
                  <dt className="font-semibold text-white">{point.title}</dt>
                  <dd className="max-w-[60ch] leading-relaxed">{point.text}</dd>
                </div>
              ))}
            </dl>
          </section>

          <section id="faq" className="scroll-mt-24 pt-16">
            <h2 className="mb-6 text-2xl font-bold tracking-tight text-white">
              {GUIDE_SECTIONS[3].title}
            </h2>
            <FaqList />
          </section>

          <p className="mt-16 text-sm text-slate-500">{PAGE_CHROME.footer}</p>
        </main>
      </div>
    </div>
  )
}
