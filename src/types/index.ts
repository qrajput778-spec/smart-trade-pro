// Shared TypeScript types for SMART TRADE PRO.
// All portfolio/balance data here represents SIMULATED paper-trading funds only.

export interface User {
  uid: string
  email: string | null
  displayName: string | null
}

export interface Holding {
  symbol: string
  quantity: number
  averageCost: number
}

export interface Portfolio {
  userId: string
  cashBalance: number
  holdings: Holding[]
}

/** Shape of the Firestore document at users/{uid}, created on signup. */
export interface UserAccountDocument {
  displayName: string
  email: string
  balance: number
  holdings: Record<string, Holding>
  // Firestore serverTimestamp() resolves to a Timestamp once read back.
  createdAt: unknown
}
