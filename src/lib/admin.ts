// Admin-only actions for SMART TRADE PRO.
//
// Every function here is a QA/support tool that only ever touches simulated,
// virtual numbers — there is no real money, no deposit source, and no
// withdrawal destination anywhere in this file. Access is gated client-side
// by AdminRoute and server-side by the isAdmin checks in firestore.rules
// (deployed and live).

import { collection, doc, runTransaction, serverTimestamp, setDoc } from 'firebase/firestore'
import { db } from './firebase'
import { roundUsd } from './trading'
import type { TradeOutcomeMode } from '../types'

export class AdminActionError extends Error {}

function requireDb() {
  if (!db) {
    throw new AdminActionError('Firebase is not configured yet — add your project keys to .env.')
  }
  return db
}

export interface AdjustBalanceResult {
  previousBalance: number
  newBalance: number
}

/**
 * Sets a target user's virtual balance to an exact number, logging who did
 * it, what it changed from/to, and why — for accountability, not for any
 * real financial reconciliation. Reads the current balance and writes the
 * adminActions record in the same transaction so the logged
 * "previousBalance" can never drift from what was actually overwritten.
 */
export async function adjustUserBalance(
  adminUid: string,
  targetUid: string,
  newBalance: number,
  reason: string,
): Promise<AdjustBalanceResult> {
  const firestore = requireDb()

  const trimmedReason = reason.trim()
  if (!trimmedReason) {
    throw new AdminActionError('A reason is required for accountability.')
  }
  if (!(newBalance >= 0) || !Number.isFinite(newBalance)) {
    throw new AdminActionError('Balance must be a number greater than or equal to zero.')
  }

  const roundedNewBalance = roundUsd(newBalance)
  const targetRef = doc(firestore, 'users', targetUid)
  let previousBalance = 0

  await runTransaction(firestore, async (transaction) => {
    const snapshot = await transaction.get(targetRef)
    if (!snapshot.exists()) {
      throw new AdminActionError('Target account not found.')
    }

    const data = snapshot.data()
    previousBalance = typeof data.balance === 'number' ? data.balance : 0

    transaction.update(targetRef, { balance: roundedNewBalance })

    const actionRef = doc(collection(firestore, 'adminActions'))
    transaction.set(actionRef, {
      adminUid,
      targetUid,
      previousBalance,
      newBalance: roundedNewBalance,
      reason: trimmedReason,
      timestamp: serverTimestamp(),
    })
  })

  return { previousBalance, newBalance: roundedNewBalance }
}

// ---------------------------------------------------------------------------
// Global Trade Outcome Control — a persistent mode, not a one-time sweep.
//
// This replaced an earlier "process every currently-open trade once" bulk
// action. That model couldn't affect trades opened *after* the click, and
// left currently-open trades alone once processed — not what's wanted here.
// Instead, this writes one singleton document
// (systemSettings/tradeOutcomeControl) that every settlement path reads
// FRESH, inside its own transaction, at the moment a trade actually exits —
// see src/lib/trading.ts's executeSellOrder (closes a LONG) and
// closeShortOrder (closes a SHORT). That's what makes a mode change affect
// both trades already open right now (whenever the user/flow eventually
// closes them) and every trade opened from now on, with nothing here
// needing to enumerate or touch any trade directly.
//
// Exactly one of NORMAL/FORCE_WIN/FORCE_LOSS is ever active because the
// document has a single `mode` field — there is no separate boolean per
// mode to ever disagree with each other.
// ---------------------------------------------------------------------------

/**
 * Sets the global trade outcome mode. A plain `setDoc` (full overwrite) is
 * correct here rather than a transaction: there's exactly one field that
 * matters for correctness (`mode`), the write is a full replace of a
 * single document, and Firestore rules (not a client-side read-then-write)
 * are what actually guarantee only an admin can ever call this — see
 * firestore.rules' systemSettings/{settingId} match.
 */
export async function setGlobalTradeOutcomeMode(
  adminUid: string,
  adminEmail: string | null,
  mode: TradeOutcomeMode,
): Promise<void> {
  const firestore = requireDb()
  if (mode !== 'NORMAL' && mode !== 'FORCE_WIN' && mode !== 'FORCE_LOSS') {
    throw new AdminActionError('Invalid trade outcome mode.')
  }

  await setDoc(doc(firestore, 'systemSettings', 'tradeOutcomeControl'), {
    mode,
    updatedBy: adminUid,
    updatedByEmail: adminEmail ?? null,
    updatedAt: serverTimestamp(),
  })
}
