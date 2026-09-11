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
  totalRealizedPnl?: number
  /**
   * Ticker symbols the user is tracking, e.g. ["BTC", "ETH"]. Absent on
   * accounts that predate this field — treat missing as "every tracked
   * symbol" (see useWatchlist's DEFAULT_WATCHLIST), not as empty.
   */
  watchlist?: string[]
  /**
   * Grants access to /admin/*. Defaults to false/absent for every account.
   * No client code ever sets this — it's only ever flipped by hand in the
   * Firestore console. AdminRoute/Sidebar only ever *read* it.
   */
  isAdmin?: boolean
}

/** One executed Buy/Sell, at users/{uid}/transactions/{id}. */
export interface TransactionDoc {
  type: 'buy' | 'sell'
  symbol: string
  qty: number
  price: number
  total: number
  realizedPnl?: number
  timestamp: unknown
}

/** One accountability record for an admin balance adjustment, at adminActions/{id}. */
export interface AdminActionDoc {
  adminUid: string
  targetUid: string
  previousBalance: number
  newBalance: number
  reason: string
  timestamp: unknown
}

/**
 * The fixed thread doc at users/{uid}/supportChat/thread. Fields beyond
 * uid are a denormalized "preview" of the latest message, kept in sync by
 * src/lib/supportChat.ts on every send — this is what lets AdminSupport.tsx
 * list active threads with one cheap collectionGroup query instead of
 * scanning every message of every user.
 */
export interface SupportChatThreadDoc {
  uid: string
  lastMessage: string
  lastMessageAt: unknown
  lastSenderRole: 'user' | 'admin'
}

/** One message at users/{uid}/supportChat/thread/messages/{id}. Written by a real person only. */
export interface SupportChatMessageDoc {
  senderId: string
  senderRole: 'user' | 'admin'
  text: string
  timestamp: unknown
}
