import type { Metadata } from 'next'
import Link from 'next/link'
import { LandingHeader } from '@/components/features/landing/LandingHeader'
import { AssistantPreview, FeeTable } from '@/components/features/landing/LandingVisuals'
import { PNLCalendar } from '@/components/features/dashboard/PNLCalendar'
import { PNLChart } from '@/components/features/dashboard/PNLChart'
import { AppLogo } from '@/components/ui/AppLogo'
import { ExchangeLogo } from '@/components/ui/ExchangeLogo'
import { createSupabaseServerClient } from '@/lib/db/supabase-server'
import { EXCHANGE_BRANDING, APP_NAME } from '@/lib/exchangeBranding'
import { LANDING_COPY, LANDING_PATHS, LANDING_SITE } from '@/lib/content/landing'
import { buildSampleCalendar, buildSampleChart } from '@/lib/content/landingSample'
import { getLocale } from '@/lib/i18n/server'
import { EXCHANGES } from '@/lib/types'

const FOCUS_RING =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary dark:focus-visible:ring-accent'
const PRIMARY_BUTTON = `inline-flex items-center justify-center rounded-lg bg-primary px-6 py-3 text-base font-bold text-white transition-colors hover:bg-primary/90 ${FOCUS_RING}`
const SECONDARY_BUTTON = `inline-flex items-center justify-center rounded-lg border border-slate-300 px-6 py-3 text-base font-semibold text-slate-800 transition-colors hover:bg-slate-100 dark:border-neutral-border dark:text-slate-200 dark:hover:bg-neutral-dark ${FOCUS_RING}`
const SECTION = 'mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-28'
const H2 = 'text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white sm:text-4xl'
const BODY = 'max-w-[56ch] text-lg leading-relaxed text-slate-600 dark:text-slate-300'

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale()
  const { meta } = LANDING_COPY[locale]
  const base = process.env.NEXT_PUBLIC_APP_URL || LANDING_SITE.productionUrl
  return {
    metadataBase: new URL(base),
    title: { absolute: meta.title },
    description: meta.description,
    alternates: { canonical: '/' },
    openGraph: {
      type: 'website',
      siteName: APP_NAME,
      title: meta.title,
      description: meta.description,
      url: '/',
      images: [{ url: LANDING_SITE.ogImagePath, alt: APP_NAME }],
    },
    twitter: {
      card: 'summary',
      title: meta.title,
      description: meta.description,
      images: [LANDING_SITE.ogImagePath],
    },
  }
}

async function hasSession(): Promise<boolean> {
  try {
    const supabase = await createSupabaseServerClient()
    const { data } = await supabase.auth.getUser()
    return data.user !== null
  } catch {
    return false
  }
}

export default async function LandingPage(): Promise<React.JSX.Element> {
  const [locale, signedIn] = await Promise.all([getLocale(), hasSession()])
  const copy = LANDING_COPY[locale]
  const now = new Date()
  const chart = buildSampleChart(now)
  const calendar = buildSampleCalendar(now)
  const [pnl, fees, assistant, demo] = copy.features

  return (
    <div className="min-h-screen bg-background-light text-slate-700 selection:bg-primary/60 selection:text-white dark:bg-background-dark dark:text-slate-300">
      <LandingHeader copy={copy.nav} signedIn={signedIn} />
      <main>
        <section className="mx-auto max-w-6xl px-4 pb-16 pt-16 sm:px-6 sm:pb-24 sm:pt-24">
          <h1 className="max-w-4xl text-4xl font-extrabold leading-[1.08] tracking-tight text-slate-900 dark:text-white sm:text-6xl">
            {copy.hero.title}
          </h1>
          <p className={`${BODY} mt-6 sm:text-xl`}>{copy.hero.lead}</p>
          <div className="mt-9 flex flex-col gap-3 sm:flex-row">
            {signedIn ? (
              <Link href={LANDING_PATHS.dashboard} className={PRIMARY_BUTTON}>
                {copy.nav.dashboard}
              </Link>
            ) : (
              <>
                <Link href={LANDING_PATHS.register} className={PRIMARY_BUTTON}>
                  {copy.nav.getStarted}
                </Link>
                <Link href={LANDING_PATHS.login} className={SECONDARY_BUTTON}>
                  {copy.nav.signIn}
                </Link>
              </>
            )}
          </div>
          <div className="mt-14 sm:mt-20">
            <PNLChart chart={chart} />
            <p className="mt-3 text-sm text-slate-500">{copy.hero.sampleNote}</p>
          </div>
        </section>

        <section className="border-y border-slate-200 dark:border-neutral-border">
          <div className="mx-auto flex max-w-6xl flex-col gap-8 px-4 py-14 sm:px-6 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h2 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">{copy.exchanges.title}</h2>
              <p className="mt-2 max-w-[48ch] text-slate-600 dark:text-slate-400">{copy.exchanges.lead}</p>
            </div>
            <ul className="flex flex-wrap gap-x-8 gap-y-4">
              {EXCHANGES.map((exchange) => (
                <li key={exchange} className="flex items-center gap-3 text-base font-semibold text-slate-900 dark:text-white">
                  <ExchangeLogo exchange={exchange} size={32} />
                  {EXCHANGE_BRANDING[exchange].name}
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className={SECTION}>
          <div className="grid grid-cols-[minmax(0,1fr)] items-center gap-10 lg:grid-cols-2 lg:gap-16">
            <FeatureText feature={pnl} />
            <PNLCalendar calendar={calendar} />
          </div>
        </section>

        <section className="border-y border-slate-200 dark:border-neutral-border">
          <div className={SECTION}>
            <div className="grid grid-cols-[minmax(0,1fr)] items-center gap-10 lg:grid-cols-2 lg:gap-16">
              <div className="lg:order-2">
                <FeatureText feature={fees} />
              </div>
              <div className="lg:order-1">
                <FeeTable copy={copy.fees} />
              </div>
            </div>
          </div>
        </section>

        <section className={SECTION}>
          <div className="grid grid-cols-[minmax(0,1fr)] items-center gap-10 lg:grid-cols-2 lg:gap-16">
            <FeatureText feature={assistant} />
            <AssistantPreview copy={copy.assistant} />
          </div>
        </section>

        <section className="border-y border-slate-200 dark:border-neutral-border">
          <div className={SECTION}>
            <FeatureText feature={demo} />
          </div>
        </section>

        <section className={SECTION}>
          <h2 className={H2}>{copy.security.title}</h2>
          <p className={`${BODY} mt-4`}>{copy.security.lead}</p>
          <dl className="mt-10 grid gap-8 md:grid-cols-3">
            {copy.security.points.map((point) => (
              <div key={point.title} className="border-t border-slate-300 pt-5 dark:border-neutral-border">
                <dt className="text-lg font-bold text-slate-900 dark:text-white">{point.title}</dt>
                <dd className="mt-2 leading-relaxed text-slate-600 dark:text-slate-400">{point.text}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="border-t border-slate-200 dark:border-neutral-border">
          <div className={SECTION}>
            <h2 className={H2}>{copy.cta.title}</h2>
            <p className={`${BODY} mt-4`}>{copy.cta.lead}</p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link href={signedIn ? LANDING_PATHS.dashboard : LANDING_PATHS.register} className={PRIMARY_BUTTON}>
                {signedIn ? copy.nav.dashboard : copy.nav.getStarted}
              </Link>
              <Link href={LANDING_PATHS.howItWorks} className={SECONDARY_BUTTON}>
                {copy.cta.learnMore}
              </Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-slate-200 dark:border-neutral-border">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-8 text-sm text-slate-500 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div className="flex items-center gap-3">
            <AppLogo size={24} />
            <span>{copy.footer.rights}</span>
          </div>
          <Link href={LANDING_PATHS.howItWorks} className={`rounded-lg hover:text-slate-900 dark:hover:text-white ${FOCUS_RING}`}>
            {copy.footer.guide}
          </Link>
        </div>
      </footer>
    </div>
  )
}

type FeatureTextProps = {
  feature: { title: string; text: string; points: string[] }
}

function FeatureText({ feature }: FeatureTextProps): React.JSX.Element {
  return (
    <div>
      <h2 className={H2}>{feature.title}</h2>
      <p className={`${BODY} mt-4`}>{feature.text}</p>
      <ul className="mt-6 space-y-2">
        {feature.points.map((point) => (
          <li key={point} className="flex items-center gap-3 text-slate-800 dark:text-slate-200">
            <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-primary dark:bg-accent" />
            {point}
          </li>
        ))}
      </ul>
    </div>
  )
}
