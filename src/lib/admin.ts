// Admin-only actions for SMART TRADE PRO.
//
// Every function here is a QA/support tool that only ever touches simulated,
// virtual numbers — there is no real money, no deposit source, and no
// withdrawal destination anywhere in this file. Access is gated client-side
// by AdminRoute and server-side by the isAdmin checks in firestore.rules
// (deployed and live).

import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  runTransaction,
  serverTimestamp,
  setDoc,
  writeBatch,
  type CollectionReference,
  type Firestore,
} from 'firebase/firestore'
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

// ---------------------------------------------------------------------------
// Remove User — AdminUserDetail's Danger Zone.
// ---------------------------------------------------------------------------

const USER_SUBCOLLECTIONS_TO_DELETE = ['transactions', 'portfolioSnapshots', 'timedTrades'] as const
const DELETE_BATCH_SIZE = 500 // Firestore's per-batch write cap.

export interface RemoveUserResult {
  targetEmail: string
}

async function deleteCollectionInBatches(firestore: Firestore, collectionRef: CollectionReference) {
  const snapshot = await getDocs(collectionRef)
  for (let i = 0; i < snapshot.docs.length; i += DELETE_BATCH_SIZE) {
    const batch = writeBatch(firestore)
    snapshot.docs.slice(i, i + DELETE_BATCH_SIZE).forEach((docSnapshot) => batch.delete(docSnapshot.ref))
    await batch.commit()
  }
}

/**
 * Permanently removes a user's Smart Trade Pro account: their profile doc,
 * every document in its transactions/portfolioSnapshots/timedTrades
 * subcollections, and their support chat thread — mirrors the owner's own
 * Settings > Delete Account flow (src/lib/account.ts's deleteAccount),
 * extended to also clean up the timedTrades and supportChat data that
 * didn't exist yet when that one was written.
 *
 * Refuses to run against another admin account or the caller's own account
 * (an admin removes themselves via Settings like everyone else, not here) —
 * firestore.rules enforces the "never another admin" half of that
 * server-side too, so this check is defense-in-depth, not the only guard.
 *
 * IMPORTANT LIMITATION: this can only ever delete Firestore data. There is
 * no client-side way for one signed-in user — even an admin — to delete a
 * DIFFERENT user's Firebase Authentication credentials; that requires the
 * Admin SDK running on a trusted server (e.g. a Cloud Function), which this
 * project has no backend for. If the removed person signs in again
 * afterward, Firebase Auth will still accept their credentials, but the app
 * will find no profile document for them and will not function — which is
 * the accepted tradeoff here, short of also revoking the account by hand in
 * the Firebase console.
 */
export async function removeUserAccount(
  adminUid: string,
  adminEmail: string | null,
  targetUid: string,
  reason: string,
): Promise<RemoveUserResult> {
  const firestore = requireDb()

  const trimmedReason = reason.trim()
  if (!trimmedReason) {
    throw new AdminActionError('A reason is required for accountability.')
  }
  if (targetUid === adminUid) {
    throw new AdminActionError('You cannot remove your own account from the admin panel — use Settings instead.')
  }

  const targetRef = doc(firestore, 'users', targetUid)
  const targetSnapshot = await getDoc(targetRef)
  if (!targetSnapshot.exists()) {
    throw new AdminActionError('Target account not found — it may have already been removed.')
  }
  const targetData = targetSnapshot.data()
  if (targetData.isAdmin === true) {
    throw new AdminActionError('Another admin account cannot be removed from here.')
  }
  const targetEmail = typeof targetData.email === 'string' ? targetData.email : '—'

  for (const subcollectionName of USER_SUBCOLLECTIONS_TO_DELETE) {
    await deleteCollectionInBatches(firestore, collection(targetRef, subcollectionName))
  }

  // Support chat: the messages subcollection, then the fixed-id thread doc
  // itself — most users never opened Support, so a missing thread is normal.
  await deleteCollectionInBatches(firestore, collection(targetRef, 'supportChat', 'thread', 'messages'))
  await deleteDoc(doc(targetRef, 'supportChat', 'thread')).catch(() => {
    // No thread ever existed for this user.
  })

  await deleteDoc(targetRef)

  // Logged last, only once the removal actually completed — see
  // adjustUserBalance above for the same "adminUid must match the caller"
  // rule this relies on (firestore.rules' adminActions/{actionId}).
  await addDoc(collection(firestore, 'adminActions'), {
    adminUid,
    adminEmail: adminEmail ?? null,
    targetUid,
    targetEmail,
    action: 'REMOVE_USER',
    reason: trimmedReason,
    timestamp: serverTimestamp(),
  })

  return { targetEmail }
}
