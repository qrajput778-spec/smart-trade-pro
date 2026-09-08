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
