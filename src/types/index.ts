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
  /**
   * Running total of this user's own currently-pending withdrawal request
   * amounts (src/lib/balanceRequests.ts) — a reservation, NOT a second
   * balance field. Incremented when a withdrawal request is submitted,
   * released back down when that same request is approved or rejected, so
   * the user's pending requests can never collectively ask for more than
   * `balance` actually holds. Absent on accounts that have never submitted
   * a withdrawal request — treat missing as 0.
   */
  pendingWithdrawalTotal?: number
}

export type BalanceRequestType = 'deposit' | 'withdrawal'
export type BalanceRequestStatus = 'pending' | 'approved' | 'rejected'

/**
 * One user-submitted deposit or withdrawal request, at balanceRequests/{id}
 * (top-level collection, not nested under users/{uid} — this keeps admin's
 * "every request across every user" queries a plain collection read with no
 * collection-group index required). Submitting one never touches `balance`
 * by itself; only an admin's approval (src/lib/balanceRequests.ts) does,
 * and firestore.rules enforces that only an admin can ever move `status`
 * off 'pending'.
 */
export interface BalanceRequestDoc {
  userId: string
  userEmail: string
  type: BalanceRequestType
  amount: number
  status: BalanceRequestStatus
  createdAt: unknown
  reviewedAt: unknown | null
  reviewedBy: string | null
  adminNote: string | null
  /**
   * Withdrawal-only, informational: the destination the user typed in the
   * Withdraw modal. Purely for the admin to see while reviewing — there's
   * no real payment rail behind it, nothing is ever actually sent there.
   */
  recipientAddress?: string
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
