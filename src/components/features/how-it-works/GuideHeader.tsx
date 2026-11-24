import Link from 'next/link'
import { AppLogo } from '@/components/ui/AppLogo'
import { APP_NAME } from '@/lib/exchangeBranding'
import { PAGE_CHROME } from '@/lib/content/howItWorks'

export function GuideHeader(): React.JSX.Element {
  return (
    <header className="sticky top-0 z-20 border-b border-neutral-border bg-background-dark/90 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
        <Link
          href="/"
          aria-label={PAGE_CHROME.homeLabel}
          className="flex items-center gap-3 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <AppLogo size={32} />
          <span className="text-lg font-bold tracking-tight text-white">{APP_NAME}</span>
        </Link>
        <nav className="flex items-center gap-2">
          <Link
            href={PAGE_CHROME.loginHref}
            className="rounded-lg px-4 py-2 text-sm font-semibold text-slate-300 transition-colors hover:bg-neutral-dark hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            {PAGE_CHROME.loginLabel}
          </Link>
          <Link
            href={PAGE_CHROME.signupHref}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-bold text-white shadow-lg shadow-primary/20 transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            {PAGE_CHROME.signupLabel}
          </Link>
        </nav>
      </div>
    </header>
  )
}
