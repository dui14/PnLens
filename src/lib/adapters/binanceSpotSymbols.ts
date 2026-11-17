export type SpotCatalogEntry = {
  symbol: string
  baseAsset: string
  quoteAsset: string
}

type RawSymbol = { symbol?: unknown; baseAsset?: unknown; quoteAsset?: unknown }

export function parseSpotCatalog(body: unknown): SpotCatalogEntry[] | null {
  const symbols = (body as { symbols?: unknown } | null)?.symbols
  if (!Array.isArray(symbols)) return null
  const entries: SpotCatalogEntry[] = []
  for (const row of symbols as RawSymbol[]) {
    if (typeof row?.symbol !== 'string' || typeof row.baseAsset !== 'string' || typeof row.quoteAsset !== 'string') {
      continue
    }
    entries.push({ symbol: row.symbol, baseAsset: row.baseAsset, quoteAsset: row.quoteAsset })
  }
  return entries
}

export function expandAssetsToSymbols(
  assets: Iterable<string>,
  catalog: SpotCatalogEntry[] | null,
  quotes: readonly string[]
): string[] {
  const wanted = new Set(assets)
  const symbols: string[] = []
  if (catalog) {
    for (const entry of catalog) {
      if (wanted.has(entry.baseAsset) && quotes.includes(entry.quoteAsset)) symbols.push(entry.symbol)
    }
    return symbols
  }
  for (const asset of wanted) {
    for (const quote of quotes) {
      if (asset !== quote) symbols.push(`${asset}${quote}`)
    }
  }
  return symbols
}

export function bStockAssets(body: unknown, namePattern: RegExp): string[] {
  if (!Array.isArray(body)) return []
  const assets: string[] = []
  for (const row of body as { coin?: unknown; name?: unknown }[]) {
    if (typeof row?.coin === 'string' && typeof row.name === 'string' && namePattern.test(row.name)) {
      assets.push(row.coin)
    }
  }
  return assets
}

export function windowsBetween(startMs: number, endMs: number, sizeMs: number): { start: number; end: number }[] {
  const windows: { start: number; end: number }[] = []
  let cursor = startMs
  while (cursor < endMs) {
    const end = Math.min(cursor + sizeMs, endMs)
    windows.push({ start: cursor, end })
    cursor = end + 1
  }
  return windows
}
