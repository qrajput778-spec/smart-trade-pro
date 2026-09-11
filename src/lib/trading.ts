// Simulated Buy/Sell execution for SMART TRADE PRO.
//
// Every "order" here is a Firestore field update on the signed-in user's own
// document — never a real payment, a real asset custody event, or a real
// order sent to any exchange. runTransaction is used (not a plain
// read-then-write) so a price/balance change between page load and clicking
// Execute can't produce a stale, incorrect write.

import { collection, deleteField, doc, increment, runTransaction, serverTimestamp, updateDoc } from 'firebase/firestore'
import { db } from './firebase'
import { STARTING_VIRTUAL_BALANCE } from './constants'
import type { HoldingsMap } from '../types'

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
      throw new TradingError('Insufficient virtual cash for this order.')
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
  const total = roundUsd(roundedQty * roundedPrice)

  if (!(roundedQty > 0)) throw new TradingError('Enter an amount greater than zero.')
  if (!(roundedPrice > 0)) throw new TradingError('Waiting for a live price — try again in a moment.')

  const userRef = doc(firestore, 'users', uid)
  let realizedPnl = 0

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

    const remainingQty = roundQty(existing.qty - roundedQty)
    // Realized P&L on the sold portion only: (sale price - cost basis) * qty sold.
    realizedPnl = roundUsd((roundedPrice - existing.avgBuyPrice) * roundedQty)
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
      price: roundedPrice,
      total,
      realizedPnl,
      timestamp: serverTimestamp(),
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

  return { symbol, qty: roundedQty, price: roundedPrice, total, realizedPnl }
}

/**
 * Resets a user's simulated portfolio back to day-one state: starting cash,
 * no holdings, no accumulated realized P&L. Shared by Dashboard, Wallet, and
 * Settings so there's exactly one implementation of "reset" to keep correct.
 * Trade/transaction history is left in place — this only touches the
 * account's current balance/holdings/P&L, not its past record.
 */
export async function resetPortfolio(uid: string): Promise<void> {
  const firestore = requireDb()
  await updateDoc(doc(firestore, 'users', uid), {
    balance: STARTING_VIRTUAL_BALANCE,
    holdings: {},
    totalRealizedPnl: 0,
  })
}
