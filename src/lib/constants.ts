// Shared display constants for SMART TRADE PRO.

/** Starting virtual balance every new simulated account is seeded with. */
export const STARTING_VIRTUAL_BALANCE = 10_000

export const TRACKED_SYMBOLS = ['BTC', 'ETH', 'SOL', 'XRP', 'BNB'] as const

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
