// Simulated Buy/Sell execution for SMART TRADE PRO.
//
// Every "order" here is a Firestore field update on the signed-in user's own
// document — never a real payment, a real asset custody event, or a real
// order sent to any exchange. runTransaction is used (not a plain
// read-then-write) so a price/balance change between page load and clicking
// Execute can't produce a stale, incorrect write.

import {
  collection,
  deleteField,
  doc,
  increment,
  runTransaction,
  serverTimestamp,
  type Firestore,
  type Transaction,
} from 'firebase/firestore'
import { db } from './firebase'
import type { AdminTradeAction, HoldingsMap, TradeOutcomeMode } from '../types'

export type OrderSide = 'buy' | 'sell'

export interface OrderResult {
  symbol: string
  qty: number
  price: number
  total: number
  /** Only present for sells — realized gain/loss on the sold quantity. */
  realizedPnl?: number
}

/** Thrown for expected, user-facing order problems — its message is safe to show directly. */
export class TradingError extends Error {}

const USD_DECIMALS = 2
const QTY_DECIMALS = 8

export function roundUsd(value: number): number {
  const factor = 10 ** USD_DECIMALS
  return Math.round((value + Number.EPSILON) * factor) / factor
}

export function roundQty(value: number): number {
  const factor = 10 ** QTY_DECIMALS
  return Math.round((value + Number.EPSILON) * factor) / factor
}

// ---------------------------------------------------------------------------
// Tiered profit rate — timed trades only (src/lib/timedTrading.ts's
// settleTimedTradeIfDue). A WINNING timed trade no longer returns a flat
// +100% of investedAmount; instead the profit PERCENTAGE scales with how
// much was invested, per this fixed table. LOSSES are completely untouched
// by this — a losing trade still simply forfeits the full investedAmount,
// exactly as before. This is the one place the tier table is defined; every
// caller (settlement, the live pre-settlement preview in Trade.tsx, the
// result popup) goes through these two functions rather than re-deriving it.
// ---------------------------------------------------------------------------

/**
 * The profit rate for a given invested amount, per the fixed tier table.
 * Boundaries are inclusive on the low end, exclusive on the high end (e.g.
 * exactly $2,000 is already the 7% tier, not 5%) — checked with plain
 * numeric comparisons, so there's no ambiguity at the exact boundary values.
 */
export function getProfitRateByInvestment(amount: number): number {
  if (amount >= 50000) return 0.13
  if (amount >= 25000) return 0.12
  if (amount >= 14000) return 0.11
  if (amount >= 7000) return 0.09
  if (amount >= 2000) return 0.07
  // Covers the documented $1–$2,000 tier (5%); a timed trade can never
  // actually be opened for less than $1 (openTimedTrade requires
  // investedAmount > 0 and the UI's minimum is $1), so this branch is also
  // the safe fallback for that unreachable case.
  return 0.05
}

export interface TieredProfit {
  /** e.g. 0.07 for the 7% tier. */
  profitRate: number
  /** e.g. 7 for the 7% tier — the same rate, expressed as a whole-number percentage for display. */
  profitPercentage: number
  /** investedAmount * profitRate, rounded to cents. */
  profitAmount: number
}

/** Profit rate + profit amount for a WINNING trade of this invested amount. Never used for a loss. */
export function calculateTieredProfit(investedAmount: number): TieredProfit {
  const profitRate = getProfitRateByInvestment(investedAmount)
  return {
    profitRate,
    profitPercentage: roundUsd(profitRate * 100),
    profitAmount: roundUsd(investedAmount * profitRate),
  }
}

function requireDb() {
  if (!db) {
    throw new TradingError('Firebase is not configured yet — add your project keys to .env.')
  }
  return db
}

/**
 * Values a full holdings map at current market prices, falling back to a
 * position's own average buy price for any symbol the caller doesn't have a
 * live price for (e.g. a market that's since gone untracked) — only used to
 * compute the portfolio snapshot, never balance/holdings themselves.
 */
function valueHoldings(holdings: HoldingsMap, priceLookup: Record<string, number>): number {
  return Object.entries(holdings).reduce((sum, [symbol, holding]) => {
    const price = priceLookup[symbol] ?? holding.avgBuyPrice
    return sum + holding.qty * price
  }, 0)
}

export async function executeBuyOrder(
  uid: string,
  symbol: string,
  qty: number,
  price: number,
  priceLookup: Record<string, number>,
): Promise<OrderResult> {
  const firestore = requireDb()

  const roundedQty = roundQty(qty)
  const roundedPrice = roundUsd(price)
  const total = roundUsd(roundedQty * roundedPrice)

  if (!(roundedQty > 0)) throw new TradingError('Enter an amount greater than zero.')
  if (!(roundedPrice > 0)) throw new TradingError('Waiting for a live price — try again in a moment.')

  const userRef = doc(firestore, 'users', uid)

  await runTransaction(firestore, async (transaction) => {
    const snapshot = await transaction.get(userRef)
    if (!snapshot.exists()) throw new TradingError('Account not found.')

    const data = snapshot.data()
    const balance = typeof data.balance === 'number' ? data.balance : 0
    const holdings = (data.holdings as HoldingsMap | undefined) ?? {}

    // Re-validated against the value read *inside* the transaction, not the
    // possibly-stale value the page rendered with.
    if (total > balance) {
      throw new TradingError('Insufficient available balance for this order.')
    }

    const existing = holdings[symbol]
    const newQty = roundQty((existing?.qty ?? 0) + roundedQty)
    const newAvgBuyPrice =
      existing && existing.qty > 0
        ? roundUsd((existing.qty * existing.avgBuyPrice + roundedQty * roundedPrice) / newQty)
        : roundedPrice

    const newCash = roundUsd(balance - total)
    const updatedHoldings: HoldingsMap = {
      ...holdings,
      [symbol]: { qty: newQty, avgBuyPrice: newAvgBuyPrice },
    }

    transaction.update(userRef, {
      balance: newCash,
      [`holdings.${symbol}`]: { qty: newQty, avgBuyPrice: newAvgBuyPrice },
    })

    const transactionRef = doc(collection(userRef, 'transactions'))
    transaction.set(transactionRef, {
      type: 'buy',
      symbol,
      qty: roundedQty,
      price: roundedPrice,
      total,
      timestamp: serverTimestamp(),
    })

    // Lightweight portfolio value history — one point per trade. Written in
    // the same transaction so it can never drift from the balance/holdings
    // write that produced it.
    const holdingsValue = roundUsd(valueHoldings(updatedHoldings, priceLookup))
    const snapshotRef = doc(collection(userRef, 'portfolioSnapshots'))
    transaction.set(snapshotRef, {
      totalValue: roundUsd(newCash + holdingsValue),
      cash: newCash,
      holdingsValue,
      timestamp: serverTimestamp(),
    })
  })

  return { symbol, qty: roundedQty, price: roundedPrice, total }
}

// ---------------------------------------------------------------------------
// Global Trade Outcome Control — the admin's persistent, singleton mode at
// systemSettings/tradeOutcomeControl (set via src/lib/admin.ts's
// setGlobalTradeOutcomeMode, shown live on the admin Trade Outcome Control
// page). Every settlement below — a normal user-initiated Sell/Close of a
// LONG, or a Cover of a SHORT — reads this document FRESH, as a read inside
// its own runTransaction, at the exact moment the position exits. That's
// what makes a mode change apply to trades already open right now (the
// next time they're closed) as well as every trade opened from now on,
// with nothing needing to enumerate or touch any position directly the
// moment the admin flips the toggle.
//
// While NORMAL (or before this document has ever been written), the
// caller's own live-market price is used untouched — zero behavior change
// from before this feature existed. While FORCE_WIN/FORCE_LOSS, the exit
// price is replaced with one guaranteed to produce that outcome, a fixed
// percentage off the position's own entry price — the same kind of
// guaranteed-outcome price the project's earlier admin force-tools used,
// just resolved at settlement time instead of by an explicit admin click.
// ---------------------------------------------------------------------------

/** Guaranteed-outcome margin applied to a position's own entry price while FORCE_WIN is active. */
export const FORCE_WIN_MARGIN = 0.05 // 5%
/** Guaranteed-outcome margin applied to a position's own entry price while FORCE_LOSS is active. */
export const FORCE_LOSS_MARGIN = 0.05 // 5%

export interface SettlementOverride {
  adminControlled: true
  adminAction: Extract<AdminTradeAction, 'GLOBAL_MODE_WIN' | 'GLOBAL_MODE_LOSS'>
  adminActionBy: string | null
  forcedResult: 'WIN' | 'LOSS'
}

export interface ResolvedSettlementPrice {
  /** The price to actually settle at — the caller's market price, unless a forced mode overrides it. */
  price: number
  /** Non-null only when a forced mode produced this price, for stamping the settlement's audit fields. */
  override: SettlementOverride | null
}

/**
 * Reads the global trade outcome mode as part of the calling transaction
 * (so it can never be a stale value from before the transaction started)
 * and resolves the price this settlement should actually use. `side` says
 * which price direction is the *winning* one for this position — a LONG
 * wins on a higher exit price, a SHORT wins on a lower one — so the same
 * function correctly mirrors the margin for both from one FORCE_WIN/
 * FORCE_LOSS mode. Exported so src/lib/timedTrading.ts's settlement can
 * reuse the exact same global-mode logic rather than a second copy of it.
 */
export async function resolveSettlementPrice(
  transaction: Transaction,
  firestore: Firestore,
  marketPrice: number,
  entryPrice: number,
  side: 'LONG' | 'SHORT',
): Promise<ResolvedSettlementPrice> {
  const settingsRef = doc(firestore, 'systemSettings', 'tradeOutcomeControl')
  const settingsSnapshot = await transaction.get(settingsRef)
  const settingsData = settingsSnapshot.exists() ? settingsSnapshot.data() : null
  const mode: TradeOutcomeMode =
    settingsData?.mode === 'FORCE_WIN' || settingsData?.mode === 'FORCE_LOSS' ? settingsData.mode : 'NORMAL'

  if (mode === 'NORMAL') {
    return { price: marketPrice, override: null }
  }

  const winningDirectionIsUp = side === 'LONG'
  const wantsWin = mode === 'FORCE_WIN'
  const moveUp = wantsWin === winningDirectionIsUp
  const margin = wantsWin ? FORCE_WIN_MARGIN : FORCE_LOSS_MARGIN
  const price = roundUsd(entryPrice * (moveUp ? 1 + margin : 1 - margin))

  return {
    price,
    override: {
      adminControlled: true,
      adminAction: wantsWin ? 'GLOBAL_MODE_WIN' : 'GLOBAL_MODE_LOSS',
      adminActionBy: typeof settingsData?.updatedBy === 'string' ? settingsData.updatedBy : null,
      forcedResult: wantsWin ? 'WIN' : 'LOSS',
    },
  }
}

export async function executeSellOrder(
  uid: string,
  symbol: string,
  qty: number,
  price: number,
  priceLookup: Record<string, number>,
): Promise<OrderResult> {
  const firestore = requireDb()

  const roundedQty = roundQty(qty)
  const roundedPrice = roundUsd(price)

  if (!(roundedQty > 0)) throw new TradingError('Enter an amount greater than zero.')
  if (!(roundedPrice > 0)) throw new TradingError('Waiting for a live price — try again in a moment.')

  const userRef = doc(firestore, 'users', uid)
  let realizedPnl = 0
  let executedPrice = roundedPrice
  let executedTotal = 0

  await runTransaction(firestore, async (transaction) => {
    const snapshot = await transaction.get(userRef)
    if (!snapshot.exists()) throw new TradingError('Account not found.')

    const data = snapshot.data()
    const balance = typeof data.balance === 'number' ? data.balance : 0
    const holdings = (data.holdings as HoldingsMap | undefined) ?? {}
    const existing = holdings[symbol]

    if (!existing || existing.qty < roundedQty) {
      throw new TradingError(
        `You only hold ${existing?.qty ?? 0} ${symbol} — you can't sell more than you have.`,
      )
    }

    // Resolved fresh, inside this same transaction — see the Global Trade
    // Outcome Control section above.
    const { price: effectivePrice, override } = await resolveSettlementPrice(
      transaction,
      firestore,
      roundedPrice,
      existing.avgBuyPrice,
      'LONG',
    )
    const total = roundUsd(roundedQty * effectivePrice)
    executedPrice = effectivePrice
    executedTotal = total

    const remainingQty = roundQty(existing.qty - roundedQty)
    // Realized P&L on the sold portion only: (sale price - cost basis) * qty sold.
    realizedPnl = roundUsd((effectivePrice - existing.avgBuyPrice) * roundedQty)
    const newCash = roundUsd(balance + total)

    // avgBuyPrice of any remaining quantity is left unchanged (standard
    // average-cost behavior) — only the sold portion's gain/loss is realized.
    const updatedHoldings: HoldingsMap = { ...holdings }
    const holdingUpdate: Record<string, unknown> = {}
    if (remainingQty > 0) {
      const remaining = { qty: remainingQty, avgBuyPrice: existing.avgBuyPrice }
      updatedHoldings[symbol] = remaining
      holdingUpdate[`holdings.${symbol}`] = remaining
    } else {
      delete updatedHoldings[symbol]
      holdingUpdate[`holdings.${symbol}`] = deleteField()
    }

    transaction.update(userRef, {
      balance: newCash,
      // Missing on accounts created before this feature — Firestore's
      // increment() treats a missing numeric field as 0, so this is safe
      // for every existing account, not just new ones.
      totalRealizedPnl: increment(realizedPnl),
      ...holdingUpdate,
    })

    const transactionRef = doc(collection(userRef, 'transactions'))
    transaction.set(transactionRef, {
      type: 'sell',
      symbol,
      qty: roundedQty,
      price: effectivePrice,
      total,
      realizedPnl,
      timestamp: serverTimestamp(),
      ...(override && {
        adminControlled: override.adminControlled,
        adminAction: override.adminAction,
        adminActionBy: override.adminActionBy,
        adminActionAt: serverTimestamp(),
        forcedResult: override.forcedResult,
      }),
    })

    const holdingsValue = roundUsd(valueHoldings(updatedHoldings, priceLookup))
    const snapshotRef = doc(collection(userRef, 'portfolioSnapshots'))
    transaction.set(snapshotRef, {
      totalValue: roundUsd(newCash + holdingsValue),
      cash: newCash,
      holdingsValue,
      timestamp: serverTimestamp(),
    })
  })

  return { symbol, qty: roundedQty, price: executedPrice, total: executedTotal, realizedPnl }
}

// ---------------------------------------------------------------------------
// Short selling ("Sell" when the user doesn't hold enough of the coin to
// cover it — see Trade.tsx, which routes to executeSellOrder above when the
// user's spot holding covers the requested qty, and to executeShortOrder
// here for the shortfall). A short is tracked in its own `shorts` map on the
// user doc — pooled per symbol at a weighted-average entry price, exactly
// like `holdings`, but never touching `holdings` itself: opening a short
// never requires or creates spot ownership of the coin.
//
// Balance model: this simulator has no margin calls or leverage, so opening
// a short simply reserves its full notional (qty * entryPrice) from cash up
// front — the same debit a Buy makes, just against a `shorts` position
// instead of a `holdings` one. Closing it credits back that reservation
// plus/minus the short's P&L, floored at 0 so a short can never do worse
// than losing its own reservation (computeShortSettlement below is the one
// place this floor is applied, reused by admin.ts's Force Win/Force Loss on
// a short so both paths can never disagree on the payout).
// ---------------------------------------------------------------------------

export interface ShortSettlement {
  /** Realized (or, for an open position, unrealized-if-closed-now) P&L — already clamped and rounded. */
  pnl: number
  /** Cash to credit back to balance on an actual close — the released reservation plus/minus pnl, never negative. */
  creditBack: number
}

export function computeShortSettlement(entryPrice: number, closePrice: number, qty: number): ShortSettlement {
  const reserved = qty * entryPrice
  // Short P&L is the mirror of long P&L: (entryPrice - closePrice) * qty —
  // a short profits when price falls, loses when price rises.
  const rawPnl = (entryPrice - closePrice) * qty
  // Loss can never exceed what was reserved when the short was opened —
  // there's no margin call/liquidation mechanic here, so this is the
  // simulator's hard floor rather than an approximation of one.
  const pnl = roundUsd(Math.max(rawPnl, -reserved))
  const creditBack = roundUsd(Math.max(0, reserved + pnl))
  return { pnl, creditBack }
}

/**
 * Opens (or adds to) a simulated short position: reserves qty * price from
 * the user's cash balance and blends it into their `shorts[symbol]` entry
 * at a weighted-average entry price — the exact same blend executeBuyOrder
 * uses for `holdings`, just applied to the short side. Never touches
 * `holdings`, and never requires the user to already hold the coin.
 */
export async function executeShortOrder(
  uid: string,
  symbol: string,
  qty: number,
  price: number,
  priceLookup: Record<string, number>,
): Promise<OrderResult> {
  const firestore = requireDb()

  const roundedQty = roundQty(qty)
  const roundedPrice = roundUsd(price)
  const total = roundUsd(roundedQty * roundedPrice)

  if (!(roundedQty > 0)) throw new TradingError('Enter an amount greater than zero.')
  if (!(roundedPrice > 0)) throw new TradingError('Waiting for a live price — try again in a moment.')

  const userRef = doc(firestore, 'users', uid)

  await runTransaction(firestore, async (transaction) => {
    const snapshot = await transaction.get(userRef)
    if (!snapshot.exists()) throw new TradingError('Account not found.')

    const data = snapshot.data()
    const balance = typeof data.balance === 'number' ? data.balance : 0
    const holdings = (data.holdings as HoldingsMap | undefined) ?? {}
    const shorts = (data.shorts as HoldingsMap | undefined) ?? {}

    // Re-validated against the value read *inside* the transaction, not the
    // possibly-stale value the page rendered with.
    if (total > balance) {
      throw new TradingError('Insufficient available balance to open this short position.')
    }

    const existing = shorts[symbol]
    const newQty = roundQty((existing?.qty ?? 0) + roundedQty)
    const newEntryPrice =
      existing && existing.qty > 0
        ? roundUsd((existing.qty * existing.avgBuyPrice + roundedQty * roundedPrice) / newQty)
        : roundedPrice

    const newCash = roundUsd(balance - total)

    transaction.update(userRef, {
      balance: newCash,
      [`shorts.${symbol}`]: { qty: newQty, avgBuyPrice: newEntryPrice },
    })

    const transactionRef = doc(collection(userRef, 'transactions'))
    transaction.set(transactionRef, {
      type: 'sell',
      positionType: 'SHORT',
      symbol,
      qty: roundedQty,
      price: roundedPrice,
      total,
      timestamp: serverTimestamp(),
    })

    // Same lightweight portfolio-value history point Buy/Sell write — cash
    // and spot holdings only, matching valueHoldings' existing formula.
    // Open short notional/unrealized P&L isn't folded into this number, so
    // a value-over-time point right after opening a short slightly
    // undercounts that exposure — a documented simplification, not a
    // balance bug (the balance/holdings fields themselves are always exact).
    const holdingsValue = roundUsd(valueHoldings(holdings, priceLookup))
    const snapshotRef = doc(collection(userRef, 'portfolioSnapshots'))
    transaction.set(snapshotRef, {
      totalValue: roundUsd(newCash + holdingsValue),
      cash: newCash,
      holdingsValue,
      timestamp: serverTimestamp(),
    })
  })

  return { symbol, qty: roundedQty, price: roundedPrice, total }
}

/**
 * Closes (or reduces) a simulated short position at the given price, using
 * computeShortSettlement for the exact same clamped P&L/credit math
 * admin.ts's Force Win/Force Loss uses when forcing a short's outcome.
 * Never touches `holdings`.
 */
export async function closeShortOrder(
  uid: string,
  symbol: string,
  qty: number,
  price: number,
): Promise<OrderResult> {
  const firestore = requireDb()

  const roundedQty = roundQty(qty)
  const roundedPrice = roundUsd(price)

  if (!(roundedQty > 0)) throw new TradingError('Enter an amount greater than zero.')
  if (!(roundedPrice > 0)) throw new TradingError('Waiting for a live price — try again in a moment.')

  const userRef = doc(firestore, 'users', uid)
  let realizedPnl = 0
  let executedPrice = roundedPrice
  let executedTotal = 0

  await runTransaction(firestore, async (transaction) => {
    const snapshot = await transaction.get(userRef)
    if (!snapshot.exists()) throw new TradingError('Account not found.')

    const data = snapshot.data()
    const balance = typeof data.balance === 'number' ? data.balance : 0
    const shorts = (data.shorts as HoldingsMap | undefined) ?? {}
    const existing = shorts[symbol]

    if (!existing || existing.qty < roundedQty) {
      throw new TradingError(
        `You only have an open short of ${existing?.qty ?? 0} ${symbol} — you can't close more than that.`,
      )
    }

    // Resolved fresh, inside this same transaction — see the Global Trade
    // Outcome Control section above. For a SHORT, "winning" means the exit
    // price is BELOW entry (the mirror of a LONG), which resolveSettlementPrice
    // already accounts for via the `side` argument.
    const { price: effectivePrice, override } = await resolveSettlementPrice(
      transaction,
      firestore,
      roundedPrice,
      existing.avgBuyPrice,
      'SHORT',
    )

    const remainingQty = roundQty(existing.qty - roundedQty)
    const { pnl, creditBack } = computeShortSettlement(existing.avgBuyPrice, effectivePrice, roundedQty)
    realizedPnl = pnl
    const newCash = roundUsd(balance + creditBack)
    executedPrice = effectivePrice
    executedTotal = roundUsd(roundedQty * effectivePrice)

    const shortUpdate: Record<string, unknown> = {}
    if (remainingQty > 0) {
      shortUpdate[`shorts.${symbol}`] = { qty: remainingQty, avgBuyPrice: existing.avgBuyPrice }
    } else {
      shortUpdate[`shorts.${symbol}`] = deleteField()
    }

    transaction.update(userRef, {
      balance: newCash,
      totalRealizedPnl: increment(pnl),
      ...shortUpdate,
    })

    const transactionRef = doc(collection(userRef, 'transactions'))
    transaction.set(transactionRef, {
      type: 'buy',
      positionType: 'SHORT',
      symbol,
      qty: roundedQty,
      price: effectivePrice,
      total: executedTotal,
      realizedPnl: pnl,
      timestamp: serverTimestamp(),
      ...(override && {
        adminControlled: override.adminControlled,
        adminAction: override.adminAction,
        adminActionBy: override.adminActionBy,
        adminActionAt: serverTimestamp(),
        forcedResult: override.forcedResult,
      }),
    })
  })

  return { symbol, qty: roundedQty, price: executedPrice, total: executedTotal, realizedPnl }
}
