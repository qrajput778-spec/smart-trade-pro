// Admin-only actions for SMART TRADE PRO.
//
// Every function here is a QA/support tool that only ever touches simulated,
// virtual numbers — there is no real money, no deposit source, and no
// withdrawal destination anywhere in this file. Access is gated client-side
// by AdminRoute and server-side by the (draft, not yet deployed) isAdmin
// check in firestore.rules.

import { collection, doc, runTransaction, serverTimestamp } from 'firebase/firestore'
import { db } from './firebase'
import { roundUsd } from './trading'

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
