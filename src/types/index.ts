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
  /**
   * Open SIMULATED short positions, pooled per symbol exactly like
   * `holdings` (weighted-average entry price, not per-lot) — see
   * src/lib/trading.ts's executeShortOrder/closeShortOrder. Reuses the same
   * HoldingEntry shape; `avgBuyPrice` here means "average entry (short)
   * price," not a buy price. Fully independent of `holdings`: opening a
   * short never touches spot holdings, and never requires (or creates)
   * owning the underlying coin. Absent on every account that predates this
   * feature — treat missing as no open shorts.
   */
  shorts?: HoldingsMap
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

/**
 * FORCE_WIN/FORCE_LOSS (the old per-trade Trade Control page) and
 * FORCE_ALL_WIN/FORCE_ALL_LOSS (the old one-time "process every open trade
 * now" bulk sweep) are both legacy — kept only so historical documents that
 * already carry them stay type-valid. GLOBAL_MODE_WIN/GLOBAL_MODE_LOSS are
 * current: stamped automatically by src/lib/trading.ts's executeSellOrder/
 * closeShortOrder whenever a trade settles while the persistent
 * systemSettings/tradeOutcomeControl mode (src/lib/admin.ts) is active.
 */
export type AdminTradeAction = 'FORCE_WIN' | 'FORCE_LOSS' | 'FORCE_ALL_WIN' | 'FORCE_ALL_LOSS' | 'GLOBAL_MODE_WIN' | 'GLOBAL_MODE_LOSS'

/**
 * The persistent global setting at systemSettings/tradeOutcomeControl —
 * a singleton document (not one per admin) read by every trade-settlement
 * code path (src/lib/trading.ts) at the moment a position actually closes,
 * and read live by the admin's Trade Outcome Control page. 'NORMAL' (the
 * default when this document doesn't exist yet) means real market-price
 * settlement; FORCE_WIN/FORCE_LOSS override the exit price of every
 * settlement to guarantee that outcome until an admin changes the mode
 * again. Exactly one of the three at a time by construction — there's only
 * one `mode` field, not two independent booleans, so "both forced modes
 * active at once" is structurally impossible rather than merely disallowed.
 */
export type TradeOutcomeMode = 'NORMAL' | 'FORCE_WIN' | 'FORCE_LOSS'

export interface TradeOutcomeControlDoc {
  mode: TradeOutcomeMode
  updatedBy: string
  updatedByEmail: string | null
  updatedAt: unknown
}

/**
 * Which pooled position map (`holdings` vs `shorts`) a transaction affects.
 * Absent on every document written before short-selling existed — treat
 * missing as 'LONG', which is exactly what those documents always were.
 * Combined with `type`, this fully classifies every transaction:
 *   type: 'buy',  positionType: 'LONG'  — normal Buy (opens/adds a long)
 *   type: 'sell', positionType: 'LONG'  — normal Sell (closes/reduces a long)
 *   type: 'sell', positionType: 'SHORT' — Sell-to-open (opens/adds a short)
 *   type: 'buy',  positionType: 'SHORT' — Buy-to-cover (closes/reduces a short)
 */
export type PositionType = 'LONG' | 'SHORT'

/** One executed Buy/Sell, at users/{uid}/transactions/{id}. */
export interface TransactionDoc {
  type: 'buy' | 'sell'
  positionType?: PositionType
  symbol: string
  qty: number
  price: number
  total: number
  realizedPnl?: number
  timestamp: unknown
  /**
   * Set only when this settlement happened while the admin's global
   * Trade Outcome Control mode (systemSettings/tradeOutcomeControl) was
   * FORCE_WIN or FORCE_LOSS — a SIMULATED override for a course project,
   * never a real trade decision. Absent on every normal, market-priced
   * settlement, so existing documents that predate this feature (and every
   * trade settled while the mode is NORMAL) are unaffected — treat missing
   * as false/null.
   */
  adminControlled?: boolean
  adminAction?: AdminTradeAction | null
  adminActionBy?: string | null
  adminActionAt?: unknown | null
  forcedResult?: 'WIN' | 'LOSS' | null
  adminNotes?: string | null
  /**
   * Present only on a record written by the timed-trade flow
   * (src/lib/timedTrading.ts) — links back to the users/{uid}/timedTrades/
   * {id} doc this leg belongs to, so admin/history views built for spot
   * trades (AdminTrades.tsx, Wallet.tsx) show timed trades too without any
   * changes, while still being able to tell them apart. Absent on every
   * spot Buy/Sell/Short/Cover record.
   */
  tradeMode?: 'TIMED'
  timedTradeId?: string
  duration?: TimedTradeDuration
  durationSeconds?: number
}

export type TimedTradeDuration = '1m' | '5m' | '15m' | '1h'
export type TimedTradeStatus = 'OPEN' | 'CLOSED'

/**
 * One timed/binary-style contract, at users/{uid}/timedTrades/{id} — a
 * DIFFERENT product from the pooled spot longs/shorts in `holdings`/
 * `shorts`: each one is tracked individually (never pooled with others of
 * the same symbol), opens by reserving `investedAmount` from cash exactly
 * like a short does, and settles automatically at `scheduledCloseAt` (see
 * src/lib/timedTrading.ts) rather than by a manual Close Trade click.
 * `scheduledCloseAt` is validated by firestore.rules to be within a small
 * tolerance of the real server time (`request.time`) plus `durationSeconds`
 * at creation, and settlement itself is only allowed once `request.time`
 * has actually reached it — so neither the schedule nor the settlement gate
 * ever trusts the client's own clock.
 */
export interface TimedTradeDoc {
  side: 'BUY' | 'SELL'
  direction: PositionType
  symbol: string
  entryPrice: number
  quantity: number
  investedAmount: number
  duration: TimedTradeDuration
  durationSeconds: number
  openedAt: unknown
  scheduledCloseAt: unknown
  status: TimedTradeStatus
  // Present only once status is CLOSED. This is a fixed-payout (binary
  // options style) contract, not a real-price-scaled one: `result` is
  // WIN/LOSS decided by price direction only (which way the market moved
  // relative to entry, LONG/SHORT-aware — or the forced outcome under
  // FORCE_WIN/FORCE_LOSS), and the payout is always the full
  // `investedAmount` either way — never a fraction of it. `realizedPnl` is
  // therefore always exactly +investedAmount (WIN) or -investedAmount
  // (LOSS), and `returnAmount` is always exactly 2x invested (WIN) or 0
  // (LOSS) — see src/lib/timedTrading.ts's settleTimedTradeIfDue.
  exitPrice?: number
  closedAt?: unknown
  result?: 'WIN' | 'LOSS'
  realizedPnl?: number
  returnAmount?: number
  // Set only when settlement happened while the global Trade Outcome
  // Control mode (systemSettings/tradeOutcomeControl) was FORCE_WIN/
  // FORCE_LOSS — same convention as TransactionDoc's admin-audit fields.
  adminControlled?: boolean
  adminAction?: AdminTradeAction | null
  adminActionBy?: string | null
  forcedResult?: 'WIN' | 'LOSS' | null
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

export type KycDocumentType = 'idCard' | 'drivingLicense' | 'passport' | 'photo'
export type KycStatus = 'pending' | 'verified' | 'rejected'

/**
 * One uploaded file's metadata within a kycSubmissions doc. Deliberately
 * holds only a Storage path + filename, never the file itself and never a
 * persisted download URL (a Firebase Storage download URL carries a bearer
 * token that bypasses security rules for anyone who has it — storing one
 * would make that file effectively public forever). Viewers fetch a fresh
 * getDownloadURL() on demand instead, gated by storage.rules at that
 * moment (src/lib/kyc.ts's getKycFileUrl).
 */
export interface KycDocumentInfo {
  uploaded: boolean
  fileName: string
  storagePath: string
  uploadedAt: unknown
}

/**
 * One KYC verification attempt, at kycSubmissions/{id} (top-level
 * collection, not nested under users/{uid} — same reasoning as
 * BalanceRequestDoc: admin's "every submission across every user" view
 * stays a plain collection read, no collection-group index required).
 * Resubmitting after a rejection creates a NEW document rather than
 * overwriting this one, so a user's past attempts remain visible as
 * history — "current status" is simply whichever submission is newest.
 *
 * This is a simulated identity-verification workflow for demonstrating a
 * realistic admin-review flow in a course project — nothing here is
 * checked against a real identity, government database, or KYC provider;
 * an admin just reviews the uploaded files and clicks Approve/Reject. See
 * README.md's top-of-file notice.
 */
export interface KycSubmissionDoc {
  userId: string
  userEmail: string
  status: KycStatus
  // Exactly one of these three is required at submission time (the user's
  // choice of which government ID to provide); photo is always required.
  idCard: KycDocumentInfo | null
  drivingLicense: KycDocumentInfo | null
  passport: KycDocumentInfo | null
  photo: KycDocumentInfo
  submittedAt: unknown
  reviewedAt: unknown | null
  reviewedBy: string | null
  rejectionReason: string | null
  createdAt: unknown
  updatedAt: unknown
}
