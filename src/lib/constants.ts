// Shared display constants for SMART TRADE PRO.

export const TRACKED_SYMBOLS = ['BTC', 'ETH', 'SOL', 'XRP', 'BNB'] as const

/**
 * Type-safe membership check against TRACKED_SYMBOLS for an arbitrary
 * string (e.g. a route param) — the tuple's own `.includes` is typed to
 * only accept its exact literal members, which a plain `string` never
 * satisfies, so this is the one place that cast lives instead of being
 * repeated at every call site.
 */
export function isTrackedSymbol(symbol: string): boolean {
  return (TRACKED_SYMBOLS as readonly string[]).includes(symbol)
}

/**
 * The symbol the Trading Terminal opens on by default — for a bare /trade
 * visit, or when the URL's :symbol isn't one this app actually tracks
 * (see TradeIndex.tsx and Trade.tsx). Prefers BTC (always tracked today),
 * otherwise falls back to whichever symbol is first in TRACKED_SYMBOLS.
 */
export const DEFAULT_TRADE_SYMBOL: string = isTrackedSymbol('BTC') ? 'BTC' : TRACKED_SYMBOLS[0]

export function formatUsd(value: number, options?: Intl.NumberFormatOptions): string {
  // minimumFractionDigits must not exceed maximumFractionDigits, so when a
  // caller overrides only one of them, derive the other rather than always
  // falling back to the 2/2 default (which would throw a RangeError).
  const maximumFractionDigits = options?.maximumFractionDigits ?? 2
  const minimumFractionDigits = Math.min(options?.minimumFractionDigits ?? 2, maximumFractionDigits)

  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    ...options,
    minimumFractionDigits,
    maximumFractionDigits,
  }).format(value)
}
