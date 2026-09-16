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
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  where,
  writeBatch,
  type CollectionReference,
  type Firestore,
} from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { db, functions } from './firebase'
import { isSupabaseConfigured, supabase } from './supabase'
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
// Remove User — AdminUserDetail's / AdminUsers' Danger Zone.
//
// A COMPLETE, permanent deletion has two halves that run in a deliberate
// order — Auth first, then data — because they fail differently:
//
//   1. The Firebase Authentication account. A signed-in client — even an
//      admin's — cannot delete a DIFFERENT user's Auth credentials itself;
//      only the Admin SDK can, and that must run on a trusted server. This
//      calls the deleteUserAuthAccount Cloud Function (functions/src/index.ts)
//      for exactly that. If this step fails, NOTHING else runs — no
//      Firestore or Storage data is touched — so a failure here can never
//      leave the account able to log in AND missing its own history at the
//      same time.
//   2. Every Firestore document and Supabase Storage file this account
//      owns. Only attempted once step 1 has actually succeeded, so
//      "success" is never reported for a run that only wiped local data —
//      see removeUserAccount's return value and the RemoveUserPartialError
//      it throws if this half fails partway.
//
// Both halves are safe to retry: deleteUserAuthAccount treats an
// already-deleted target as success (see its own comment), and every
// Firestore/Storage delete below is naturally idempotent — deleting an
// already-gone document or object is a no-op, not an error.
// ---------------------------------------------------------------------------

const USER_SUBCOLLECTIONS_TO_DELETE = ['transactions', 'portfolioSnapshots', 'timedTrades'] as const
const DELETE_BATCH_SIZE = 500 // Firestore's per-batch write cap.

// The exact KycDocumentInfo-shaped fields src/lib/kyc.ts's kycSubmissions
// docs use — duplicated here rather than imported to keep this file from
// depending on KYC's internal doc-type list; every one of these MUST match
// src/types/index.ts's KycSubmissionDoc for storage cleanup to be complete.
const KYC_DOC_FIELDS = ['idCardFront', 'idCardBack', 'drivingLicenseFront', 'drivingLicenseBack', 'photo'] as const

export interface RemoveUserResult {
  targetEmail: string
  /** Counts for the confirmation message — never sensitive, just tallies. */
  deletedCounts: {
    transactions: number
    portfolioSnapshots: number
    timedTrades: number
    supportMessages: number
    kycSubmissions: number
    balanceRequests: number
  }
}

/** Thrown ONLY when the Auth account was already successfully deleted but the data cleanup afterward failed partway. Never a plain AdminActionError — the caller must not treat this as a normal, retry-from-scratch failure. */
export class RemoveUserPartialError extends AdminActionError {
  constructor(message: string) {
    super(message)
    this.name = 'RemoveUserPartialError'
  }
}

async function deleteCollectionInBatches(firestore: Firestore, collectionRef: CollectionReference): Promise<number> {
  const snapshot = await getDocs(collectionRef)
  for (let i = 0; i < snapshot.docs.length; i += DELETE_BATCH_SIZE) {
    const batch = writeBatch(firestore)
    snapshot.docs.slice(i, i + DELETE_BATCH_SIZE).forEach((docSnapshot) => batch.delete(docSnapshot.ref))
    await batch.commit()
  }
  return snapshot.docs.length
}

/** Every non-null storagePath across a kycSubmissions doc's document fields — exact stored paths, never a guessed or reconstructed one. */
function collectKycStoragePaths(data: Record<string, unknown>): string[] {
  const paths: string[] = []
  for (const field of KYC_DOC_FIELDS) {
    const info = data[field]
    if (info && typeof info === 'object' && 'storagePath' in info && typeof info.storagePath === 'string') {
      paths.push(info.storagePath)
    }
  }
  return paths
}

// Maps deleteUserAuthAccount's possible failure codes to a plain-language
// message — same reasoning as src/lib/authErrors.ts: never show raw
// "Firebase: ..." or bare Functions error codes to an admin. `failed-precondition`
// and `permission-denied` already carry the Cloud Function's own specific,
// user-safe message (see functions/src/index.ts) via `err.message`, so those
// pass it straight through instead of a generic one.
function getRemoveUserFunctionErrorMessage(code: string | null, err: unknown): string {
  const rawMessage =
    typeof err === 'object' && err !== null && 'message' in err && typeof (err as { message: unknown }).message === 'string'
      ? (err as { message: string }).message
      : null

  switch (code) {
    case 'functions/not-found':
      return 'The account-deletion server function is not deployed yet — see functions/README.md, then try again.'
    case 'functions/unavailable':
    case 'functions/deadline-exceeded':
      return 'Could not reach the account-deletion server function — check your connection and try again.'
    case 'functions/permission-denied':
    case 'functions/unauthenticated':
      return rawMessage ?? 'You are not authorized to perform this action.'
    case 'functions/failed-precondition':
      return rawMessage ?? 'This account cannot be removed from here.'
    default:
      return rawMessage ?? 'Could not delete the Firebase Authentication account — nothing was removed. Please try again.'
  }
}

/** Best-effort Supabase Storage removal — logs and swallows failures so a Storage hiccup never blocks the Firestore cleanup that follows it. Never throws. */
async function removeStorageFiles(bucket: string, paths: string[]): Promise<void> {
  if (paths.length === 0) return
  try {
    if (!isSupabaseConfigured || !supabase) return
    const { error } = await supabase.storage.from(bucket).remove(paths)
    if (error) {
      // eslint-disable-next-line no-console
      console.error('[admin] Supabase file removal failed', { bucket, count: paths.length, message: error.message })
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[admin] Supabase file removal threw', { bucket, count: paths.length, err })
  }
}

/**
 * Permanently removes a user's ENTIRE Smart Trade Pro account:
 *
 *  1. Their Firebase Authentication account (via the deleteUserAuthAccount
 *     Cloud Function — see the section comment above) — done FIRST and
 *     required to succeed before anything else runs, so this account can
 *     never sign in again by the time any of their data is touched.
 *  2. Their Firestore profile doc, transactions/portfolioSnapshots/
 *     timedTrades subcollections, support chat thread + messages, every
 *     kycSubmissions doc naming them, and every balanceRequests doc naming
 *     them.
 *  3. Their private files in Supabase Storage: every KYC document these
 *     submissions pointed at, and every image attachment their support
 *     messages pointed at — always by the exact storagePath/imagePath
 *     already stored on that document, never a guessed path, and always
 *     scoped to files this specific user's own records named.
 *
 * Refuses to run against another admin account or the caller's own account
 * (an admin removes themselves via Settings like everyone else, not here) —
 * both the Cloud Function and firestore.rules enforce the "never another
 * admin" half of that server-side too, so these client-side checks are
 * defense-in-depth (a fast, friendly error), never the only guard.
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

  // ---- Step 1: Firebase Authentication — must succeed before anything
  // below runs. Nothing is deleted yet if this throws. ----
  if (!functions) {
    throw new AdminActionError(
      'The account-deletion server function is not configured yet — deploy functions/ (see its README) before removing users.',
    )
  }
  try {
    await httpsCallable<{ targetUid: string }, { success: true; alreadyDeleted: boolean }>(
      functions,
      'deleteUserAuthAccount',
    )({ targetUid })
  } catch (err) {
    const code = typeof err === 'object' && err !== null && 'code' in err ? String((err as { code: unknown }).code) : null
    // eslint-disable-next-line no-console
    console.error('[admin] deleteUserAuthAccount call failed', { targetUid, code })
    throw new AdminActionError(getRemoveUserFunctionErrorMessage(code, err))
  }

  // ---- Step 2 onward: the Auth account is confirmed gone. From here, any
  // failure is reported as a PARTIAL removal, never a plain retry-from-
  // scratch failure — the user can no longer log in either way. ----
  try {
    const deletedCounts = {
      transactions: 0,
      portfolioSnapshots: 0,
      timedTrades: 0,
      supportMessages: 0,
      kycSubmissions: 0,
      balanceRequests: 0,
    }

    for (const subcollectionName of USER_SUBCOLLECTIONS_TO_DELETE) {
      const count = await deleteCollectionInBatches(firestore, collection(targetRef, subcollectionName))
      deletedCounts[subcollectionName] = count
    }

    // Support chat: collect each message's image path BEFORE deleting the
    // messages themselves, remove those files from Storage, then delete the
    // messages subcollection and the fixed-id thread doc — most users never
    // opened Support, so a missing thread is normal, not an error.
    const messagesSnapshot = await getDocs(collection(targetRef, 'supportChat', 'thread', 'messages'))
    const supportImagePaths = messagesSnapshot.docs
      .map((docSnapshot) => docSnapshot.data())
      .filter((data) => data.type === 'image' && typeof data.imagePath === 'string')
      .map((data) => data.imagePath as string)
    await removeStorageFiles('support-attachments', supportImagePaths)
    deletedCounts.supportMessages = await deleteCollectionInBatches(
      firestore,
      collection(targetRef, 'supportChat', 'thread', 'messages'),
    )
    await deleteDoc(doc(targetRef, 'supportChat', 'thread')).catch(() => {
      // No thread ever existed for this user.
    })

    // KYC submissions: a top-level collection keyed by userId, not nested
    // under users/{uid} (see firestore.rules' schema comment) — collect
    // every stored file path across every submission BEFORE deleting the
    // docs, remove those files from Storage, then delete the docs.
    const kycSnapshot = await getDocs(query(collection(firestore, 'kycSubmissions'), where('userId', '==', targetUid)))
    const kycStoragePaths = kycSnapshot.docs.flatMap((docSnapshot) => collectKycStoragePaths(docSnapshot.data()))
    await removeStorageFiles('kyc-documents', kycStoragePaths)
    if (kycSnapshot.docs.length > 0) {
      for (let i = 0; i < kycSnapshot.docs.length; i += DELETE_BATCH_SIZE) {
        const batch = writeBatch(firestore)
        kycSnapshot.docs.slice(i, i + DELETE_BATCH_SIZE).forEach((docSnapshot) => batch.delete(docSnapshot.ref))
        await batch.commit()
      }
    }
    deletedCounts.kycSubmissions = kycSnapshot.docs.length

    // Deposit/withdrawal requests: also top-level, keyed by userId. No
    // Storage files of their own to remove.
    const balanceRequestsSnapshot = await getDocs(
      query(collection(firestore, 'balanceRequests'), where('userId', '==', targetUid)),
    )
    if (balanceRequestsSnapshot.docs.length > 0) {
      for (let i = 0; i < balanceRequestsSnapshot.docs.length; i += DELETE_BATCH_SIZE) {
        const batch = writeBatch(firestore)
        balanceRequestsSnapshot.docs.slice(i, i + DELETE_BATCH_SIZE).forEach((docSnapshot) => batch.delete(docSnapshot.ref))
        await batch.commit()
      }
    }
    deletedCounts.balanceRequests = balanceRequestsSnapshot.docs.length

    await deleteDoc(targetRef)

    // Logged last, only once the removal actually completed — see
    // adjustUserBalance above for the same "adminUid must match the caller"
    // rule this relies on (firestore.rules' adminActions/{actionId}).
    // Deliberately non-fatal: by this point the account and every piece of
    // its data are genuinely, fully gone — a hiccup writing the audit
    // record afterward must never surface as "partial removal, please
    // retry" (retrying would just fail with "Target account not found",
    // confusingly, since there's truly nothing left to clean up).
    try {
      await addDoc(collection(firestore, 'adminActions'), {
        adminUid,
        adminEmail: adminEmail ?? null,
        targetUid,
        targetEmail,
        action: 'REMOVE_USER',
        reason: trimmedReason,
        timestamp: serverTimestamp(),
      })
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[admin] removeUserAccount: succeeded but the adminActions log write failed', {
        targetUid,
        message: err instanceof Error ? err.message : String(err),
      })
    }

    return { targetEmail, deletedCounts }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[admin] removeUserAccount: data cleanup failed after Auth deletion succeeded', {
      targetUid,
      message: err instanceof Error ? err.message : String(err),
    })
    throw new RemoveUserPartialError(
      `${targetEmail}'s sign-in has been permanently revoked, but cleaning up their remaining data failed partway ` +
        'through. It is safe to run Remove again — already-deleted records are simply skipped — to finish the cleanup.',
    )
  }
}
