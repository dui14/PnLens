import {
  CRYPTO_RSS_NEWS_FEEDS,
  CRYPTO_RSS_NEWS_SOURCE_TIERS,
  type RssNewsTier,
} from '@/lib/config/rss-feeds'

type GetCryptoNewsArgs = {
  query?: string
  limit?: number
}

type NewsItem = {
  title: string
  link: string
  summary: string
  source: string
  publishedAt: string
}

type RankedNewsItem = NewsItem & {
  sourceTier: RssNewsTier
  queryScore: number
  totalScore: number
}

type NewsSource = {
  name: string
  url: string
  tier: RssNewsTier
}

type FetchRssFeedResult = {
  source: NewsSource
  items: NewsItem[]
  ok: boolean
}

type NextFetchInit = RequestInit & {
  next?: {
    revalidate?: number
  }
}

const NEWS_LIMIT_DEFAULT = 8
const NEWS_LIMIT_MAX = 12
const RSS_REVALIDATE_SECONDS = 300
const RSS_FETCH_TIMEOUT_MS = 7000
const QUERY_TOKEN_MIN_LENGTH = 3
const QUERY_TOKEN_MAX = 10

const QUERY_STOP_WORDS = new Set<string>([
  'a',
  'an',
  'and',
  'or',
  'the',
  'for',
  'with',
  'news',
  'today',
  'hom',
  'nay',
  'dua',
  'ra',
  'chien',
  'luoc',
  'giao',
  'dich',
  'strategy',
  'trading',
  'market',
])

const QUERY_TOKEN_SYNONYMS: Record<string, string[]> = {
  btc: ['bitcoin', 'btc'],
  bitcoin: ['bitcoin', 'btc'],
  onchain: ['onchain', 'on-chain', 'glassnode', 'whale', 'exchange'],
  'on-chain': ['onchain', 'on-chain', 'glassnode', 'whale', 'exchange'],
  etf: ['etf', 'fund'],
  price: ['price', 'outlook'],
  action: ['action', 'analysis'],
}

const RSS_FETCH_HEADERS: HeadersInit = {
  Accept: 'application/rss+xml, application/xml;q=0.9, text/xml;q=0.8, */*;q=0.5',
  'User-Agent': 'PnLens-RSS/1.0 (+https://pnlens.duii.dev)',
}

const NEWS_SOURCES: NewsSource[] = CRYPTO_RSS_NEWS_FEEDS.map((source) => ({
  ...source,
  tier: CRYPTO_RSS_NEWS_SOURCE_TIERS[source.name] ?? 3,
}))

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x2F;/g, '/')
}

function stripMarkup(value: string): string {
  return decodeXmlEntities(
    value
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, '$1')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  )
}

function extractTagValue(xmlBlock: string, tagName: string): string | null {
  const safeTag = tagName.replace(':', '\\:')
  const regex = new RegExp(`<${safeTag}[^>]*>([\\s\\S]*?)<\\/${safeTag}>`, 'i')
  const matched = xmlBlock.match(regex)
  if (!matched) return null
  return matched[1].trim()
}

function parseDateIso(value: string | null): string {
  if (!value) return new Date(0).toISOString()
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return new Date(0).toISOString()
  return parsed.toISOString()
}

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function tokenizeQuery(keyword: string): string[] {
  const baseTokens = normalizeText(keyword)
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= QUERY_TOKEN_MIN_LENGTH)
    .filter((token) => !QUERY_STOP_WORDS.has(token))

  const expanded = new Set<string>()

  for (const token of baseTokens) {
    expanded.add(token)

    const synonyms = QUERY_TOKEN_SYNONYMS[token] ?? []
    for (const synonym of synonyms) {
      if (synonym.length >= QUERY_TOKEN_MIN_LENGTH) {
        expanded.add(synonym)
      }
    }
  }

  return Array.from(expanded).slice(0, QUERY_TOKEN_MAX)
}

function readTierScore(sourceTier: RssNewsTier): number {
  if (sourceTier === 1) return 10
  if (sourceTier === 2) return 6
  return 2
}

function calculateRecencyScore(publishedAt: string): number {
  const publishedAtMs = new Date(publishedAt).getTime()
  if (!Number.isFinite(publishedAtMs) || publishedAtMs <= 0) {
    return 0
  }

  const ageHours = Math.max(0, (Date.now() - publishedAtMs) / 3600000)
  return Math.max(0, 6 - ageHours / 12)
}

function rankNewsItems(items: NewsItem[], query: string): RankedNewsItem[] {
  const normalizedQuery = normalizeText(query)
  const tokens = tokenizeQuery(query)

  return items.map((item) => {
    const title = normalizeText(item.title)
    const summary = normalizeText(item.summary)
    const sourceTier = CRYPTO_RSS_NEWS_SOURCE_TIERS[item.source] ?? 3
    let queryScore = 0

    if (normalizedQuery.length > 0) {
      if (title.includes(normalizedQuery)) {
        queryScore += 24
      }

      if (summary.includes(normalizedQuery)) {
        queryScore += 12
      }
    }

    for (const token of tokens) {
      if (title.includes(token)) {
        queryScore += 8
        continue
      }

      if (summary.includes(token)) {
        queryScore += 4
      }
    }

    const totalScore = queryScore + readTierScore(sourceTier) + calculateRecencyScore(item.publishedAt)

    return {
      ...item,
      sourceTier,
      queryScore,
      totalScore,
    }
  })
}

function sortRankedNews(a: RankedNewsItem, b: RankedNewsItem): number {
  if (b.queryScore !== a.queryScore) {
    return b.queryScore - a.queryScore
  }

  if (a.sourceTier !== b.sourceTier) {
    return a.sourceTier - b.sourceTier
  }

  const publishedDiff = new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime()
  if (publishedDiff !== 0) {
    return publishedDiff
  }

  return b.totalScore - a.totalScore
}

function parseRss(xmlText: string, source: string): NewsItem[] {
  const itemBlocks = xmlText.match(/<item[\s\S]*?<\/item>/gi) ?? []

  return itemBlocks
    .map((itemBlock) => {
      const title = stripMarkup(extractTagValue(itemBlock, 'title') ?? '')
      const link = stripMarkup(extractTagValue(itemBlock, 'link') ?? '')
      const summary = stripMarkup(
        extractTagValue(itemBlock, 'description') ??
          extractTagValue(itemBlock, 'content:encoded') ??
          extractTagValue(itemBlock, 'content') ??
          ''
      )
      const publishedAt = parseDateIso(
        extractTagValue(itemBlock, 'pubDate') ??
          extractTagValue(itemBlock, 'dc:date') ??
          extractTagValue(itemBlock, 'published') ??
          extractTagValue(itemBlock, 'updated')
      )

      return {
        title,
        link,
        summary,
        source,
        publishedAt,
      }
    })
    .filter((item) => item.title.length > 0 && item.link.length > 0)
}

function extractAtomLink(entryBlock: string): string {
  const hrefMatch = entryBlock.match(/<link\b[^>]*\bhref=(['"])(.*?)\1[^>]*\/?>(?:<\/link>)?/i)
  if (hrefMatch && hrefMatch[2]) {
    return stripMarkup(hrefMatch[2])
  }

  return stripMarkup(extractTagValue(entryBlock, 'id') ?? '')
}

function parseAtom(xmlText: string, source: string): NewsItem[] {
  const entryBlocks = xmlText.match(/<entry[\s\S]*?<\/entry>/gi) ?? []

  return entryBlocks
    .map((entryBlock) => {
      const title = stripMarkup(extractTagValue(entryBlock, 'title') ?? '')
      const link = extractAtomLink(entryBlock)
      const summary = stripMarkup(
        extractTagValue(entryBlock, 'summary') ??
          extractTagValue(entryBlock, 'content') ??
          extractTagValue(entryBlock, 'description') ??
          ''
      )
      const publishedAt = parseDateIso(
        extractTagValue(entryBlock, 'published') ??
          extractTagValue(entryBlock, 'updated') ??
          extractTagValue(entryBlock, 'dc:date')
      )

      return {
        title,
        link,
        summary,
        source,
        publishedAt,
      }
    })
    .filter((item) => item.title.length > 0 && item.link.length > 0)
}

function parseFeed(xmlText: string, source: string): NewsItem[] {
  const rssItems = parseRss(xmlText, source)
  if (rssItems.length > 0) {
    return rssItems
  }

  return parseAtom(xmlText, source)
}

async function fetchRssFeed(source: NewsSource): Promise<FetchRssFeedResult> {
  const abortController = new AbortController()
  const timeoutId = setTimeout(() => {
    abortController.abort()
  }, RSS_FETCH_TIMEOUT_MS)

  try {
    const response = await fetch(source.url, {
      next: { revalidate: RSS_REVALIDATE_SECONDS },
      signal: abortController.signal,
      headers: RSS_FETCH_HEADERS,
    } as NextFetchInit)
    if (!response.ok) {
      return {
        source,
        items: [],
        ok: false,
      }
    }

    const xmlText = await response.text()
    if (!xmlText.trim()) {
      return {
        source,
        items: [],
        ok: false,
      }
    }

    const items = parseFeed(xmlText, source.name)

    return {
      source,
      items,
      ok: items.length > 0,
    }
  } catch {
    return {
      source,
      items: [],
      ok: false,
    }
  } finally {
    clearTimeout(timeoutId)
  }
}

function deduplicateNews(items: NewsItem[]): NewsItem[] {
  const seen = new Set<string>()

  return items.filter((item) => {
    const key = `${item.link.toLowerCase()}|${item.title.toLowerCase()}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export async function getCryptoNewsTool(args: GetCryptoNewsArgs): Promise<Record<string, unknown>> {
  const rawQuery = args.query?.trim() ?? ''
  const keyword = normalizeText(rawQuery)
  const limit = clampNumber(args.limit ?? NEWS_LIMIT_DEFAULT, 1, NEWS_LIMIT_MAX)

  const feedResults = await Promise.all(NEWS_SOURCES.map((source) => fetchRssFeed(source)))
  const merged = deduplicateNews(feedResults.flatMap((result) => result.items))

  const ranked = rankNewsItems(merged, rawQuery)
  const hasQuery = keyword.length > 0
  const queryMatched = hasQuery ? ranked.filter((item) => item.queryScore > 0) : ranked
  const fallbackToPrioritized = hasQuery && queryMatched.length === 0
  const selectedPool = (fallbackToPrioritized ? ranked : queryMatched).sort(sortRankedNews)
  const selectedItems = selectedPool.slice(0, limit).map((item) => ({
    title: item.title,
    link: item.link,
    summary: item.summary,
    source: item.source,
    publishedAt: item.publishedAt,
  }))

  const succeededFeeds = feedResults.filter((result) => result.ok).length
  const failedFeeds = feedResults.length - succeededFeeds

  return {
    success: true,
    query: keyword || 'crypto',
    count: selectedItems.length,
    items: selectedItems,
    sources: {
      total: NEWS_SOURCES.length,
      failed: failedFeeds,
      succeeded: succeededFeeds,
    },
    fallback: fallbackToPrioritized || selectedItems.length === 0,
  }
}