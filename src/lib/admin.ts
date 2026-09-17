// Admin-only actions for SMART TRADE PRO.
//
// Every function here is a QA/support tool that only ever touches simulated,
// virtual numbers — there is no real money, no deposit source, and no
// withdrawal destination anywhere in this file. Access is gated client-side
// by AdminRoute and server-side by the isAdmin checks in firestore.rules
// (deployed and live).

import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type CollectionReference,
  type Firestore,
} from 'firebase/firestore'
import { db } from './firebase'
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
// Remove User — AdminUsers' Danger Zone.
//
// This project runs on Firebase's free SPARK plan, deliberately, with no
// Cloud Functions/Cloud Run/Admin SDK anywhere (all of those require the
// paid Blaze plan — see functions/README.md for the earlier attempt and
// exactly where it hit that wall). That means there is NO trusted backend
// capable of calling admin.auth().deleteUser() on a DIFFERENT user's
// behalf — only the Admin SDK can delete another user's Firebase
// Authentication credentials, a signed-in browser client never can, no
// matter who's signed in. This code does not attempt it, and never claims
// to have done it.
//
// What "Remove User" does instead — a Spark-compatible "deactivate and
// purge" — in two deliberately ordered halves:
//
//   1. DEACTIVATE. One Firestore update on the target's own users/{uid}
//      doc: tombstones it with accountStatus: 'deleted' / accessDisabled:
//      true / deletedAt / deletionReason, and zeroes its trading state
//      (balance, holdings, shorts, watchlist, totalRealizedPnl,
//      pendingWithdrawalTotal) — see firestore.rules' matching users/{uid}
//      update rule for the exact fixed shape this is restricted to. The
//      document is NOT deleted: AuthContext.tsx's login guard needs
//      something to read accountStatus/accessDisabled from, for every
//      future sign-in attempt this uid ever makes, for as long as the
//      account exists in Firebase Auth (which is forever, on Spark). Done
//      FIRST and must succeed before anything else runs, so the account is
//      guaranteed to already be locked out of the app before any of its
//      other data is touched.
//   2. PURGE. Every other Firestore document and Supabase Storage file
//      this account owns. Only attempted once step 1 has actually
//      succeeded, so "success" is never reported for a run that failed to
//      even deactivate the account — see removeUserAccount's return value
//      and the RemoveUserPartialError it throws if this half fails partway.
//
// Both halves are safe to retry: step 1 is a plain Firestore update that
// simply re-writes the same tombstone values if run again, and every
// Firestore/Storage delete in step 2 is naturally idempotent — deleting an
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

/** Thrown ONLY when the account was already successfully deactivated (locked out) but the data purge afterward failed partway. Never a plain AdminActionError — the caller must not treat this as a normal, retry-from-scratch failure. */
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

/** Best-effort Supabase Storage removal — logs and swallows failures so a Storage hiccup never blocks the Firestore cleanup that follows it. Never throws. Uses only the publishable anon key already wired up in src/lib/supabase.ts and the buckets' own delete policies (SUPABASE_STORAGE_SETUP.md) — no service-role key anywhere in this codebase. */
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
 * Permanently removes a user's Smart Trade Pro account on the Spark plan —
 * "deactivate and purge" (see the section comment above for the full
 * reasoning and why this is the correct, honest design here):
 *
 *  1. Deactivates users/{uid} in place: accountStatus/accessDisabled/
 *     deletedAt/deletionReason, plus zeroing balance/holdings/shorts/
 *     watchlist/totalRealizedPnl/pendingWithdrawalTotal. Required to
 *     succeed before anything else runs.
 *  2. Deletes transactions/portfolioSnapshots/timedTrades subcollections,
 *     the support chat thread + messages, every kycSubmissions doc naming
 *     them, and every balanceRequests doc naming them.
 *  3. Deletes their private files in Supabase Storage: every KYC document
 *     these submissions pointed at, and every image attachment their
 *     support messages pointed at — always by the exact storagePath/
 *     imagePath already stored on that document, never a guessed path.
 *  4. Records a minimal deletionAudit/{targetUid} entry — target uid,
 *     email snapshot, admin uid, reason, timestamp, status. Never KYC
 *     document content or anything else sensitive.
 *
 * This does NOT and CANNOT delete the target's Firebase Authentication
 * credentials — that requires the Admin SDK on a trusted server, which this
 * Spark-plan project deliberately has none of (see the section comment).
 * The account is instead locked out at the application layer: once
 * deactivated, AuthContext.tsx's login guard signs it back out immediately
 * on every future sign-in attempt, forever, for as long as this account
 * exists in Firebase Auth.
 *
 * Refuses to run against another admin account or the caller's own account
 * (an admin removes themselves via Settings like everyone else, not here) —
 * firestore.rules enforces the "never another admin" half of that
 * server-side too, so this client-side check is defense-in-depth (a fast,
 * friendly error), never the only guard.
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
  // Idempotency: if this account is already deactivated (a previous run got
  // at least this far), skip straight to the purge below rather than
  // re-writing the same tombstone values — either way, step 1 below is
  // itself a no-op-safe write if it does run again.
  const alreadyDeactivated = targetData.accountStatus === 'deleted' || targetData.accessDisabled === true

  // ---- Step 1: deactivate — must succeed before anything below runs. ----
  if (!alreadyDeactivated) {
    try {
      await updateDoc(targetRef, {
        accountStatus: 'deleted',
        deletedAt: serverTimestamp(),
        deletionReason: trimmedReason,
        accessDisabled: true,
        balance: 0,
        holdings: {},
        shorts: {},
        watchlist: [],
        totalRealizedPnl: 0,
        pendingWithdrawalTotal: 0,
      })
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[admin] removeUserAccount: deactivation write failed — nothing was changed', {
        targetUid,
        message: err instanceof Error ? err.message : String(err),
      })
      throw new AdminActionError('Could not disable this account — nothing was changed. Please try again.')
    }
  }

  // ---- Step 2 onward: the account is confirmed locked out already. From
  // here, any failure is reported as a PARTIAL removal, never a plain
  // retry-from-scratch failure — access is already disabled either way. ----
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

    // Minimal, dedicated audit record — see firestore.rules' deletionAudit
    // match and the file-level comment for exactly what this deliberately
    // does and doesn't store. Keyed by the target's own uid so a retried
    // run overwrites the same doc rather than piling up duplicates.
    // Deliberately non-fatal, same reasoning as adjustUserBalance's own
    // record: by this point the account is genuinely deactivated and its
    // data genuinely purged — a hiccup writing the audit record afterward
    // must never surface as "partial removal, please retry" (retrying would
    // just re-run a no-op purge, confusingly, since there's truly nothing
    // left to clean up).
    try {
      await setDoc(doc(firestore, 'deletionAudit', targetUid), {
        targetUid,
        targetEmail,
        adminUid,
        adminEmail: adminEmail ?? null,
        reason: trimmedReason,
        status: 'completed',
        timestamp: serverTimestamp(),
      })
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[admin] removeUserAccount: succeeded but the deletionAudit write failed', {
        targetUid,
        message: err instanceof Error ? err.message : String(err),
      })
    }

    return { targetEmail, deletedCounts }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[admin] removeUserAccount: data purge failed after deactivation succeeded', {
      targetUid,
      message: err instanceof Error ? err.message : String(err),
    })
    // Best-effort — recording that this run at least got the account locked
    // out is more useful than losing that fact entirely if this also fails.
    await setDoc(
      doc(firestore, 'deletionAudit', targetUid),
      {
        targetUid,
        targetEmail,
        adminUid,
        adminEmail: adminEmail ?? null,
        reason: trimmedReason,
        status: 'partial',
        timestamp: serverTimestamp(),
      },
      { merge: true },
    ).catch(() => {})
    throw new RemoveUserPartialError(
      `${targetEmail}'s access has been permanently disabled, but purging their remaining data failed partway ` +
        'through. It is safe to run Remove again — already-purged records are simply skipped — to finish the cleanup.',
    )
  }
}
