// Timed/binary-style trading for SMART TRADE PRO.
//
// A DIFFERENT product from the pooled spot longs/shorts in src/lib/trading.ts
// (holdings/shorts, weighted-average, closed manually): each timed trade is
// its own independent contract — reserve `investedAmount` from cash at open
// (exactly like opening a short reserves its notional), then settle
// automatically once `scheduledCloseAt` arrives, crediting back the
// reservation plus/minus P&L. Nothing here touches `holdings`/`shorts`.
//
// Reuses trading.ts's roundUsd/roundQty, TradingError, and — critically —
// resolveSettlementPrice, so a timed trade's settlement respects the same
// persistent Trade Outcome Control mode via the exact same logic a spot
// short's close already does. There is no separate "timed trade outcome"
// system; there is one settlement-price resolver used everywhere a
// position can exit.

import {
  collection,
  doc,
  increment,
  limit,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  Timestamp,
  type Unsubscribe,
} from 'firebase/firestore'
import { db } from './firebase'
import { roundQty, roundUsd, resolveSettlementPrice, TradingError } from './trading'
import type { PositionType, TimedTradeDoc, TimedTradeDuration } from '../types'

function requireDb() {
  if (!db) {
    throw new TradingError('Firebase is not configured yet — add your project keys to .env.')
  }
  return db
}

export interface DurationOption {
  value: TimedTradeDuration
  label: string
  seconds: number
}

export const TIMED_TRADE_DURATIONS: DurationOption[] = [
  { value: '1m', label: '1 minute', seconds: 60 },
  { value: '5m', label: '5 minutes', seconds: 300 },
  { value: '15m', label: '15 minutes', seconds: 900 },
  { value: '1h', label: '1 hour', seconds: 3600 },
]

export const DEFAULT_TIMED_TRADE_DURATION: TimedTradeDuration = '1m'

export function durationToSeconds(duration: TimedTradeDuration): number {
  return TIMED_TRADE_DURATIONS.find((option) => option.value === duration)?.seconds ?? 60
}

/** One timed trade as read back from Firestore, with timestamps resolved to real Dates. */
export interface TimedTrade extends Omit<TimedTradeDoc, 'openedAt' | 'scheduledCloseAt' | 'closedAt'> {
  id: string
  openedAt: Date | null
  scheduledCloseAt: Date | null
  closedAt: Date | null
}

function toDate(value: unknown): Date | null {
  return value instanceof Timestamp ? value.toDate() : null
}

function parseTimedTrade(id: string, data: Record<string, unknown>): TimedTrade {
  return {
    id,
    side: data.side === 'SELL' ? 'SELL' : 'BUY',
    direction: data.direction === 'SHORT' ? 'SHORT' : 'LONG',
    symbol: String(data.symbol ?? ''),
    entryPrice: typeof data.entryPrice === 'number' ? data.entryPrice : 0,
    quantity: typeof data.quantity === 'number' ? data.quantity : 0,
    investedAmount: typeof data.investedAmount === 'number' ? data.investedAmount : 0,
    duration: (data.duration as TimedTradeDuration) ?? '1m',
    durationSeconds: typeof data.durationSeconds === 'number' ? data.durationSeconds : 60,
    openedAt: toDate(data.openedAt),
    scheduledCloseAt: toDate(data.scheduledCloseAt),
    status: data.status === 'CLOSED' ? 'CLOSED' : 'OPEN',
    exitPrice: typeof data.exitPrice === 'number' ? data.exitPrice : undefined,
    closedAt: toDate(data.closedAt),
    result: data.result === 'WIN' || data.result === 'LOSS' ? data.result : undefined,
    realizedPnl: typeof data.realizedPnl === 'number' ? data.realizedPnl : undefined,
    returnAmount: typeof data.returnAmount === 'number' ? data.returnAmount : undefined,
    adminControlled: data.adminControlled === true,
    adminAction: (data.adminAction as TimedTrade['adminAction']) ?? null,
    adminActionBy: typeof data.adminActionBy === 'string' ? data.adminActionBy : null,
    forcedResult: data.forcedResult === 'WIN' || data.forcedResult === 'LOSS' ? data.forcedResult : null,
  }
}

/**
 * Live subscription to this user's own timed trades (owner-only per
 * firestore.rules — never a cross-user query), newest-opened first. Not
 * filtered by status: a status flip from OPEN to CLOSED needs to be
 * observable as a document change for the "just settled, show the result
 * popup" detection in useTimedTrades — filtering it out here would hide
 * exactly the transition that matters.
 */
export function subscribeToTimedTrades(
  uid: string,
  onChange: (trades: TimedTrade[]) => void,
  onError: (error: unknown) => void,
): Unsubscribe {
  const firestore = requireDb()
  const tradesQuery = query(
    collection(firestore, 'users', uid, 'timedTrades'),
    orderBy('openedAt', 'desc'),
    limit(100),
  )
  return onSnapshot(
    tradesQuery,
    (snapshot) => {
      onChange(snapshot.docs.map((docSnapshot) => parseTimedTrade(docSnapshot.id, docSnapshot.data())))
    },
    onError,
  )
}

export interface OpenTimedTradeResult {
  id: string
  scheduledCloseAt: Date
}

/**
 * Opens a new timed trade: reserves `investedAmount` from cash (same
 * "reserve now, release + P&L later" model a short uses) and creates the
 * timedTrades doc. `scheduledCloseAt` is computed from the CLIENT's clock
 * here, but firestore.rules independently validates it's within a small
 * tolerance of the real server time plus the duration — see
 * isValidScheduledClose() there — so a skewed or manipulated client clock
 * can't schedule a materially early or late close.
 */
export async function openTimedTrade(
  uid: string,
  symbol: string,
  direction: PositionType,
  investedAmount: number,
  entryPrice: number,
  duration: TimedTradeDuration,
): Promise<OpenTimedTradeResult> {
  const firestore = requireDb()

  const roundedInvested = roundUsd(investedAmount)
  const roundedEntry = roundUsd(entryPrice)
  const seconds = durationToSeconds(duration)

  if (!(roundedInvested > 0)) throw new TradingError('Enter an amount greater than zero.')
  if (!(roundedEntry > 0)) throw new TradingError('Waiting for a live price — try again in a moment.')

  const qty = roundQty(roundedInvested / roundedEntry)
  const scheduledCloseAt = Timestamp.fromMillis(Date.now() + seconds * 1000)

  const userRef = doc(firestore, 'users', uid)
  const tradeRef = doc(collection(userRef, 'timedTrades'))

  await runTransaction(firestore, async (transaction) => {
    const snapshot = await transaction.get(userRef)
    if (!snapshot.exists()) throw new TradingError('Account not found.')

    const balance = typeof snapshot.data().balance === 'number' ? snapshot.data().balance : 0
    if (roundedInvested > balance) {
      throw new TradingError('Insufficient virtual cash for this trade.')
    }

    transaction.update(userRef, { balance: roundUsd(balance - roundedInvested) })

    transaction.set(tradeRef, {
      side: direction === 'LONG' ? 'BUY' : 'SELL',
      direction,
      symbol,
      entryPrice: roundedEntry,
      quantity: qty,
      investedAmount: roundedInvested,
      duration,
      durationSeconds: seconds,
      openedAt: serverTimestamp(),
      scheduledCloseAt,
      status: 'OPEN',
    })

    // An "opening" leg in the same transactions history Wallet.tsx/
    // AdminTrades.tsx already read — no realizedPnl, so it's treated
    // exactly like a normal position-opening record (never gated by the
    // global outcome mode; see firestore.rules' respectsGlobalOutcomeMode()).
    const transactionRef = doc(collection(userRef, 'transactions'))
    transaction.set(transactionRef, {
      type: direction === 'LONG' ? 'buy' : 'sell',
      positionType: direction,
      tradeMode: 'TIMED',
      timedTradeId: tradeRef.id,
      symbol,
      qty,
      price: roundedEntry,
      total: roundedInvested,
      duration,
      durationSeconds: seconds,
      timestamp: serverTimestamp(),
    })
  })

  return { id: tradeRef.id, scheduledCloseAt: scheduledCloseAt.toDate() }
}

export type SettleOutcome = 'settled' | 'not_due' | 'already_settled'

/**
 * Settles one timed trade if (and only if) it's still OPEN and its
 * scheduled close time has actually arrived. Safe to call repeatedly and
 * from multiple tabs/intervals at once: the transaction re-reads the
 * trade's own `status` fresh, so only the first caller to commit actually
 * changes anything — every other concurrent or later call sees `status`
 * already 'CLOSED' and returns 'already_settled' without writing.
 * firestore.rules independently double-checks `request.time` against the
 * trade's own server-resolved `openedAt` + duration, so even a client that
 * ignores the schedule entirely can't force an early settlement.
 *
 * This is a fixed-payout (binary options style) contract: the exit price
 * (from resolveSettlementPrice — the real live price in NORMAL mode, or a
 * guaranteed-direction price under FORCE_WIN/FORCE_LOSS) only decides WIN
 * vs LOSS by which way it moved relative to entry; the payout itself is
 * always the full `investedAmount`, never a fraction scaled by how far the
 * price actually moved. See the TimedTradeDoc comment in src/types/index.ts.
 */
export async function settleTimedTradeIfDue(
  uid: string,
  tradeId: string,
  currentPrice: number,
): Promise<SettleOutcome> {
  const firestore = requireDb()
  const userRef = doc(firestore, 'users', uid)
  const tradeRef = doc(userRef, 'timedTrades', tradeId)

  return runTransaction(firestore, async (transaction) => {
    const tradeSnapshot = await transaction.get(tradeRef)
    if (!tradeSnapshot.exists()) return 'already_settled'

    const tradeData = tradeSnapshot.data()
    if (tradeData.status !== 'OPEN') return 'already_settled'

    const scheduledCloseAt = tradeData.scheduledCloseAt
    const scheduledMs = scheduledCloseAt instanceof Timestamp ? scheduledCloseAt.toMillis() : 0
    if (Date.now() < scheduledMs) return 'not_due'

    const direction: PositionType = tradeData.direction === 'SHORT' ? 'SHORT' : 'LONG'
    const entryPrice = typeof tradeData.entryPrice === 'number' ? tradeData.entryPrice : 0
    const qty = typeof tradeData.quantity === 'number' ? tradeData.quantity : 0
    const investedAmount = typeof tradeData.investedAmount === 'number' ? tradeData.investedAmount : 0
    const symbol = String(tradeData.symbol ?? '')

    const userSnapshot = await transaction.get(userRef)
    if (!userSnapshot.exists()) throw new TradingError('Account not found.')
    const balance = typeof userSnapshot.data().balance === 'number' ? userSnapshot.data().balance : 0

    // Read fresh inside this same transaction — see resolveSettlementPrice
    // in src/lib/trading.ts. NORMAL mode resolves to the real `currentPrice`
    // unchanged; FORCE_WIN/FORCE_LOSS resolves to a price guaranteed to lie
    // on the winning/losing side of entry for this trade's own direction.
    // Either way, only the *sign* of the resulting move matters below —
    // never its size.
    const { price: exitPrice, override } = await resolveSettlementPrice(
      transaction,
      firestore,
      roundUsd(currentPrice),
      entryPrice,
      direction,
    )

    // A tie (exitPrice exactly equal to entryPrice) counts as a WIN — an
    // edge case that only really arises for a NORMAL-mode trade whose
    // market genuinely didn't move at all in the window.
    const directionalMove = direction === 'LONG' ? exitPrice - entryPrice : entryPrice - exitPrice
    const won = directionalMove >= 0
    const result: 'WIN' | 'LOSS' = won ? 'WIN' : 'LOSS'

    // Fixed payout: win the full invested amount, lose the full invested
    // amount — never a fraction scaled by the (possibly tiny) price move.
    // The reservation taken at open is released here either way: on a win
    // it comes back doubled (the stake plus an equal profit); on a loss it
    // simply isn't returned. Balance can never go negative from this,
    // since `investedAmount` was already fully deducted up front at open.
    const pnl = roundUsd(won ? investedAmount : -investedAmount)
    const returnAmount = roundUsd(won ? investedAmount * 2 : 0)

    transaction.update(userRef, {
      balance: roundUsd(balance + returnAmount),
      totalRealizedPnl: increment(pnl),
    })

    transaction.update(tradeRef, {
      status: 'CLOSED',
      exitPrice,
      closedAt: serverTimestamp(),
      result,
      realizedPnl: pnl,
      returnAmount,
      ...(override && {
        adminControlled: override.adminControlled,
        adminAction: override.adminAction,
        adminActionBy: override.adminActionBy,
        forcedResult: override.forcedResult,
      }),
    })

    // Closing leg — carries realizedPnl, so firestore.rules'
    // respectsGlobalOutcomeMode() independently verifies its sign actually
    // matches whatever mode was active, the same backstop a spot short's
    // close already gets.
    const transactionRef = doc(collection(userRef, 'transactions'))
    transaction.set(transactionRef, {
      type: direction === 'LONG' ? 'sell' : 'buy',
      positionType: direction,
      tradeMode: 'TIMED',
      timedTradeId: tradeId,
      symbol,
      qty,
      price: exitPrice,
      total: returnAmount,
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

    return 'settled'
  })
}
