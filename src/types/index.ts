// Shared TypeScript types for SMART TRADE PRO.
// All portfolio/balance data here represents SIMULATED paper-trading funds only.

export interface User {
  uid: string
  email: string | null
  displayName: string | null
}

/** One open position within a user's holdings map, keyed by ticker symbol (e.g. "BTC"). */
export interface HoldingEntry {
  qty: number
  avgBuyPrice: number
}

export type HoldingsMap = Record<string, HoldingEntry>

/** Shape of the Firestore document at users/{uid}, created on signup. */
export interface UserAccountDocument {
  displayName: string
  email: string
  balance: number
  holdings: HoldingsMap
  // Firestore serverTimestamp() resolves to a Timestamp once read back.
  createdAt: unknown
}
