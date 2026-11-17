import { CRYPTO_RSS_NEWS_FEEDS } from '@/lib/config/rss-feeds'

const EXCHANGE_LINK_HOSTS: readonly string[] = [
  'binance.com',
  'okx.com',
  'bybit.com',
  'bitget.com',
  'gate.io',
]

const APP_LINK_HOSTS: readonly string[] = ['pnlens.duii.dev']

function stripWww(hostname: string): string {
  return hostname.toLowerCase().replace(/^www\./, '')
}

function feedHosts(): string[] {
  return CRYPTO_RSS_NEWS_FEEDS.map((feed) => stripWww(new URL(feed.url).hostname))
}

export const CHAT_LINK_ALLOWED_HOSTS: readonly string[] = Array.from(
  new Set([...feedHosts(), ...EXCHANGE_LINK_HOSTS, ...APP_LINK_HOSTS])
)

const HTTP_PROTOCOLS: readonly string[] = ['http:', 'https:']

function parseHttpUrl(raw: string): URL | null {
  try {
    const url = new URL(raw.trim())
    if (!HTTP_PROTOCOLS.includes(url.protocol)) return null
    if (url.username || url.password) return null
    return url
  } catch {
    return null
  }
}

export function isHttpUrl(raw: string): boolean {
  return parseHttpUrl(raw) !== null
}

function isAllowedHost(hostname: string): boolean {
  const host = hostname.toLowerCase()
  return CHAT_LINK_ALLOWED_HOSTS.some((allowed) => host === allowed || host.endsWith(`.${allowed}`))
}

export function collectToolLinkUrls(steps: readonly object[]): string[] {
  const urls: string[] = []

  for (const step of steps) {
    if (!('links' in step) || !Array.isArray(step.links)) continue

    for (const link of step.links) {
      if (link && typeof link === 'object' && 'url' in link && typeof link.url === 'string') {
        const parsed = parseHttpUrl(link.url)
        if (parsed) urls.push(parsed.href)
      }
    }
  }

  return urls
}

export function resolveSafeHref(
  href: string | undefined,
  toolUrls: readonly string[] = []
): string | null {
  if (!href) return null

  const parsed = parseHttpUrl(href)
  if (!parsed) return null

  if (toolUrls.includes(parsed.href)) return parsed.href
  if (isAllowedHost(parsed.hostname)) return parsed.href

  return null
}
