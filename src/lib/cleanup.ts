// "Empty Test Data" — Admin-only dev/test database cleanup for SMART TRADE PRO.
//
// Two halves:
//
//  - previewTestDataCleanup(): 100% read-only. Never writes, updates, or
//    deletes anything anywhere — Firestore, Supabase, or Firebase Auth. Used
//    both for the dry-run view AND as the "before" and "after" snapshot of
//    executeTestDataCleanup()'s own verification scan (see below).
//  - executeTestDataCleanup(): the real thing. Deliberately does NOT
//    reimplement any deletion logic of its own — it calls
//    src/lib/admin.ts's already-built, already-deployed removeUserAccount()
//    once per non-admin user (the exact same "deactivate in place, purge
//    subcollections/kycSubmissions/balanceRequests, remove the matching
//    Supabase files" pipeline the single-user "Remove User" tool already
//    uses, already covered by the Firestore rules and Supabase policies
//    that are live today) — never a new deletion path, never a schema
//    change, never a Firestore rule change. What THIS file adds on top is
//    purely orchestration: process every non-admin user, isolate one user's
//    failure from every other user's, skip users that are already fully
//    clean without touching them, and verify the real before/after Firestore
//    state afterward rather than just trusting its own bookkeeping.
//
// Scope note: neither function ever reads, touches, or counts
// `systemSettings/tradeOutcomeControl` (the one global admin config
// singleton), any admin's own users/{uid} doc, or the
// `adminActions`/`deletionAudit` accountability logs — none of those are
// "user application data."

import { collection, getCountFromServer, getDocs, type Firestore } from 'firebase/firestore'
import { db } from './firebase'
import { isSupabaseConfigured } from './supabase'
import { removeUserAccount, AdminActionError, RemoveUserPartialError } from './admin'

export class CleanupError extends Error {}

function requireDb(): Firestore {
  if (!db) {
    throw new CleanupError('Firebase is not configured yet — add your project keys to .env.')
  }
  return db
}

// The exact KycDocumentInfo-shaped fields src/lib/kyc.ts's kycSubmissions
// docs use — same duplicated list src/lib/admin.ts's removeUserAccount
// keeps (see its own comment for why: keeping this file from depending on
// KYC's internal doc-type list). Must stay in sync with
// src/types/index.ts's KycSubmissionDoc.
const KYC_DOC_FIELDS = ['idCardFront', 'idCardBack', 'drivingLicenseFront', 'drivingLicenseBack', 'photo'] as const

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

export interface CleanupUserPreview {
  uid: string
  email: string
  displayName: string
  /** Already carries the "Remove User" tombstone — a re-run would just re-confirm 0 remaining data for this user, not re-deactivate them. */
  alreadyDeactivated: boolean
  transactionCount: number
  portfolioSnapshotCount: number
  timedTradeCount: number
  supportMessageCount: number
  supportImageFileCount: number
  kycSubmissionCount: number
  kycFileCount: number
  balanceRequestCount: number
}

export interface CleanupPreservedAdmin {
  uid: string
  email: string
  displayName: string
}

export interface CleanupTotals {
  userCount: number
  transactionCount: number
  portfolioSnapshotCount: number
  timedTradeCount: number
  supportMessageCount: number
  kycSubmissionCount: number
  balanceRequestCount: number
  supabaseKycFileCount: number
  supabaseSupportFileCount: number
}

export interface CleanupPreview {
  generatedAt: Date
  /** Admin accounts — never touched by any cleanup run, listed here only for visibility that they were correctly excluded. */
  preservedAdmins: CleanupPreservedAdmin[]
  /** System/config/audit paths this cleanup never reads or touches, for the same reason. */
  preservedSystemPaths: string[]
  usersToClean: CleanupUserPreview[]
  totals: CleanupTotals
  /** True only if Supabase file counts could actually be computed (requires VITE_SUPABASE_* to be configured) — see CleanupTotals' supabase* fields for what "0" vs "not available" means when this is false. */
  supabaseConfigured: boolean
}

/**
 * Computes — but does NOT execute — a full preview of what an "Empty Test
 * Data" cleanup run would affect: every non-admin user, every piece of
 * Firestore data they own, and every Supabase Storage file their KYC
 * submissions/support messages point at. Read-only: every call this makes
 * is a `get`/`getCountFromServer`, nothing else.
 *
 * Supabase file counts are derived from the exact `storagePath`/`imagePath`
 * values already stored on each user's own kycSubmissions/support message
 * docs — the same source of truth src/lib/admin.ts's removeUserAccount
 * itself uses to know what to delete — never a live Storage bucket listing.
 * That keeps this preview's numbers an exact match for what a real cleanup
 * run would actually remove, with no separate Storage API calls (or their
 * own rate limits/cost) needed just to preview.
 */
export async function previewTestDataCleanup(): Promise<CleanupPreview> {
  const firestore = requireDb()

  const usersSnapshot = await getDocs(collection(firestore, 'users'))
  const admins: CleanupPreservedAdmin[] = []
  const nonAdminUsers: { uid: string; email: string; displayName: string; alreadyDeactivated: boolean }[] = []

  for (const userDoc of usersSnapshot.docs) {
    const data = userDoc.data()
    const email = typeof data.email === 'string' ? data.email : '—'
    const displayName = typeof data.displayName === 'string' ? data.displayName : '(no name)'
    if (data.isAdmin === true) {
      admins.push({ uid: userDoc.id, email, displayName })
    } else {
      nonAdminUsers.push({
        uid: userDoc.id,
        email,
        displayName,
        alreadyDeactivated: data.accountStatus === 'deleted' || data.accessDisabled === true,
      })
    }
  }

  // kycSubmissions / balanceRequests are top-level collections keyed by a
  // `userId` field, not nested under users/{uid} (see firestore.rules'
  // schema comment) — fetched whole and bucketed client-side, same
  // deliberate zero-index/zero-filter pattern already used throughout this
  // app's other admin screens (AdminKyc.tsx, BalanceRequestsAdminTable.tsx),
  // appropriate for a project-sized dataset like this one.
  const [kycSnapshot, balanceRequestsSnapshot] = await Promise.all([
    getDocs(collection(firestore, 'kycSubmissions')),
    getDocs(collection(firestore, 'balanceRequests')),
  ])

  const nonAdminUidSet = new Set(nonAdminUsers.map((u) => u.uid))
  const kycByUid = new Map<string, { count: number; filePaths: string[] }>()
  for (const kycDoc of kycSnapshot.docs) {
    const data = kycDoc.data()
    const uid = typeof data.userId === 'string' ? data.userId : null
    if (!uid || !nonAdminUidSet.has(uid)) continue
    const entry = kycByUid.get(uid) ?? { count: 0, filePaths: [] }
    entry.count += 1
    entry.filePaths.push(...collectKycStoragePaths(data))
    kycByUid.set(uid, entry)
  }

  const balanceRequestCountByUid = new Map<string, number>()
  for (const requestDoc of balanceRequestsSnapshot.docs) {
    const data = requestDoc.data()
    const uid = typeof data.userId === 'string' ? data.userId : null
    if (!uid || !nonAdminUidSet.has(uid)) continue
    balanceRequestCountByUid.set(uid, (balanceRequestCountByUid.get(uid) ?? 0) + 1)
  }

  // Per-user subcollection reads — there is deliberately no collection-group
  // Firestore rule for portfolioSnapshots/timedTrades/supportChat messages
  // (only transactions and the supportChat thread doc itself have one; see
  // firestore.rules), and this cleanup tool must not add one, so this
  // mirrors removeUserAccount's own per-user approach rather than a single
  // cross-user query.
  const userPreviews = await Promise.all(
    nonAdminUsers.map(async (user): Promise<CleanupUserPreview> => {
      const userRef = collection(firestore, 'users', user.uid, 'transactions')
      const [transactionsCount, portfolioSnapshotsCount, timedTradesCount, supportMessagesSnapshot] = await Promise.all([
        getCountFromServer(userRef),
        getCountFromServer(collection(firestore, 'users', user.uid, 'portfolioSnapshots')),
        getCountFromServer(collection(firestore, 'users', user.uid, 'timedTrades')),
        getDocs(collection(firestore, 'users', user.uid, 'supportChat', 'thread', 'messages')),
      ])

      const supportImagePaths = supportMessagesSnapshot.docs
        .map((docSnapshot) => docSnapshot.data())
        .filter((data) => data.type === 'image' && typeof data.imagePath === 'string')

      const kycEntry = kycByUid.get(user.uid)

      return {
        uid: user.uid,
        email: user.email,
        displayName: user.displayName,
        alreadyDeactivated: user.alreadyDeactivated,
        transactionCount: transactionsCount.data().count,
        portfolioSnapshotCount: portfolioSnapshotsCount.data().count,
        timedTradeCount: timedTradesCount.data().count,
        supportMessageCount: supportMessagesSnapshot.docs.length,
        supportImageFileCount: supportImagePaths.length,
        kycSubmissionCount: kycEntry?.count ?? 0,
        kycFileCount: kycEntry?.filePaths.length ?? 0,
        balanceRequestCount: balanceRequestCountByUid.get(user.uid) ?? 0,
      }
    }),
  )

  const totals: CleanupTotals = userPreviews.reduce(
    (acc, u) => ({
      userCount: acc.userCount + 1,
      transactionCount: acc.transactionCount + u.transactionCount,
      portfolioSnapshotCount: acc.portfolioSnapshotCount + u.portfolioSnapshotCount,
      timedTradeCount: acc.timedTradeCount + u.timedTradeCount,
      supportMessageCount: acc.supportMessageCount + u.supportMessageCount,
      kycSubmissionCount: acc.kycSubmissionCount + u.kycSubmissionCount,
      balanceRequestCount: acc.balanceRequestCount + u.balanceRequestCount,
      supabaseKycFileCount: acc.supabaseKycFileCount + u.kycFileCount,
      supabaseSupportFileCount: acc.supabaseSupportFileCount + u.supportImageFileCount,
    }),
    {
      userCount: 0,
      transactionCount: 0,
      portfolioSnapshotCount: 0,
      timedTradeCount: 0,
      supportMessageCount: 0,
      kycSubmissionCount: 0,
      balanceRequestCount: 0,
      supabaseKycFileCount: 0,
      supabaseSupportFileCount: 0,
    },
  )

  return {
    generatedAt: new Date(),
    preservedAdmins: admins,
    preservedSystemPaths: [
      'systemSettings/tradeOutcomeControl (global trade-outcome config)',
      'adminActions/* (balance-adjustment audit log)',
      'deletionAudit/* (Remove User audit log)',
    ],
    usersToClean: userPreviews,
    totals,
    supabaseConfigured: isSupabaseConfigured,
  }
}

// ---------------------------------------------------------------------------
// Execute — the real, destructive half. Everything above this line is
// read-only.
// ---------------------------------------------------------------------------

/** Fixed, auto-generated reason passed to removeUserAccount for every user this bulk run touches — accountability record without asking an admin to type the same reason 17 times. */
const BULK_CLEANUP_REASON = 'Bulk test-data cleanup via Admin → Test Data Cleanup'

export type CleanupUserOutcome = 'already_clean' | 'deleted' | 'failed'

export interface CleanupExecutionUserResult {
  uid: string
  email: string
  outcome: CleanupUserOutcome
  /** Only set when outcome === 'deleted' — what removeUserAccount actually purged for this user. */
  deletedCounts?: {
    transactions: number
    portfolioSnapshots: number
    timedTrades: number
    supportMessages: number
    kycSubmissions: number
    balanceRequests: number
  }
  /** Only set when outcome === 'failed' — the exact, safe-to-display reason (never a raw stack trace). */
  error?: string
}

export interface CleanupExecutionReport {
  startedAt: Date
  finishedAt: Date
  /** True only if every targeted user finished as 'already_clean' or 'deleted' AND the post-run verification scan found zero remaining non-admin data. Never true if anything failed or anything measurably remains. */
  fullySucceeded: boolean
  deletedUserCount: number
  skippedUserCount: number
  failedUserCount: number
  userResults: CleanupExecutionUserResult[]
  /** The exact preview computed immediately before the first write — ground truth for "what did this run start with." */
  before: CleanupPreview
  /** A FRESH preview computed immediately after every user finished processing — ground truth for "what's actually left," independent of what the per-user calls above claimed to do. This is what makes requirement #12's "final verification scan" real rather than self-reported. */
  after: CleanupPreview
  /** before.totals - after.totals, per category — the actual observed change, not a running counter this code kept along the way. */
  deltas: CleanupTotals
}

function isBenignAlreadyGoneError(err: unknown): boolean {
  return err instanceof AdminActionError && /already been removed|not found/i.test(err.message)
}

/**
 * Executes the real "Empty Test Data" cleanup: every non-admin user found in
 * a freshly-computed preview is either skipped (already fully clean — never
 * touched, not even a re-deactivation write) or run through
 * src/lib/admin.ts's removeUserAccount. One user's failure is caught and
 * recorded, never allowed to stop the rest of the run — see
 * isBenignAlreadyGoneError for the one case (a user vanishing between the
 * preview and this call, e.g. a concurrent admin action) treated as a skip
 * rather than a failure, matching the idempotency requirement.
 *
 * Always finishes with a second, completely independent previewTestDataCleanup()
 * call and reports the real difference — this function's own bookkeeping of
 * what it "did" is never the source of truth for what actually happened;
 * the before/after Firestore reads are.
 *
 * `onProgress`, if given, is called once per user as it finishes (not
 * before), purely for a progress indicator — never awaited, never allowed to
 * throw into this function's own control flow.
 */
export async function executeTestDataCleanup(
  adminUid: string,
  adminEmail: string | null,
  onProgress?: (done: number, total: number, user: CleanupUserPreview) => void,
): Promise<CleanupExecutionReport> {
  const startedAt = new Date()
  const before = await previewTestDataCleanup()

  const userResults: CleanupExecutionUserResult[] = []
  let done = 0

  for (const user of before.usersToClean) {
    // Already fully deactivated AND every category already at zero — a true
    // no-op. Skipped without any Firestore write at all, so a cleanup run
    // repeated any number of times never re-touches a user it already fully
    // handled, and never risks re-triggering AuthContext's deactivation
    // listener/sign-out for someone already signed out.
    const alreadyFullyClean =
      user.alreadyDeactivated &&
      user.transactionCount === 0 &&
      user.portfolioSnapshotCount === 0 &&
      user.timedTradeCount === 0 &&
      user.supportMessageCount === 0 &&
      user.kycSubmissionCount === 0 &&
      user.balanceRequestCount === 0

    if (alreadyFullyClean) {
      userResults.push({ uid: user.uid, email: user.email, outcome: 'already_clean' })
      done += 1
      try {
        onProgress?.(done, before.usersToClean.length, user)
      } catch {
        // A progress callback throwing must never abort the actual cleanup.
      }
      continue
    }

    try {
      const result = await removeUserAccount(adminUid, adminEmail, user.uid, BULK_CLEANUP_REASON)
      userResults.push({ uid: user.uid, email: user.email, outcome: 'deleted', deletedCounts: result.deletedCounts })
    } catch (err) {
      if (isBenignAlreadyGoneError(err)) {
        // Someone/something else removed this account between the preview
        // above and this call (e.g. a concurrent admin action) — nothing
        // left to do, and nothing to report as a failure.
        userResults.push({ uid: user.uid, email: user.email, outcome: 'already_clean' })
      } else {
        // Covers both a hard AdminActionError (nothing changed for this
        // user) and RemoveUserPartialError (this user's access WAS disabled
        // but their data purge didn't finish) — either way, this run did not
        // fully clean this one user, and that must be visible, not swallowed.
        const message =
          err instanceof RemoveUserPartialError || err instanceof AdminActionError
            ? err.message
            : err instanceof Error
              ? err.message
              : String(err)
        // eslint-disable-next-line no-console
        console.error('[cleanup] executeTestDataCleanup: user failed', { uid: user.uid, message })
        userResults.push({ uid: user.uid, email: user.email, outcome: 'failed', error: message })
      }
    }

    done += 1
    try {
      onProgress?.(done, before.usersToClean.length, user)
    } catch {
      // Same as above — never let a UI callback's own bug abort real cleanup.
    }
  }

  // Independent of everything above: re-read real Firestore state fresh,
  // exactly like the dry-run view does. This is the actual "did it work"
  // signal, not userResults.
  const after = await previewTestDataCleanup()

  const deltas: CleanupTotals = {
    userCount: before.totals.userCount - after.totals.userCount,
    transactionCount: before.totals.transactionCount - after.totals.transactionCount,
    portfolioSnapshotCount: before.totals.portfolioSnapshotCount - after.totals.portfolioSnapshotCount,
    timedTradeCount: before.totals.timedTradeCount - after.totals.timedTradeCount,
    supportMessageCount: before.totals.supportMessageCount - after.totals.supportMessageCount,
    kycSubmissionCount: before.totals.kycSubmissionCount - after.totals.kycSubmissionCount,
    balanceRequestCount: before.totals.balanceRequestCount - after.totals.balanceRequestCount,
    supabaseKycFileCount: before.totals.supabaseKycFileCount - after.totals.supabaseKycFileCount,
    supabaseSupportFileCount: before.totals.supabaseSupportFileCount - after.totals.supabaseSupportFileCount,
  }

  const failedUserCount = userResults.filter((r) => r.outcome === 'failed').length
  // "Fully succeeded" requires BOTH no per-user failure AND the independent
  // after-scan actually showing zero non-admin data left — a user could in
  // principle report "deleted" while one obscure record it doesn't know to
  // check about still lingers; the after-scan is what catches that, per
  // requirement #12's "confirm... report anything remaining."
  const afterIsClean =
    after.totals.userCount === 0 &&
    after.totals.transactionCount === 0 &&
    after.totals.portfolioSnapshotCount === 0 &&
    after.totals.timedTradeCount === 0 &&
    after.totals.supportMessageCount === 0 &&
    after.totals.kycSubmissionCount === 0 &&
    after.totals.balanceRequestCount === 0 &&
    (!after.supabaseConfigured || (after.totals.supabaseKycFileCount === 0 && after.totals.supabaseSupportFileCount === 0))

  return {
    startedAt,
    finishedAt: new Date(),
    fullySucceeded: failedUserCount === 0 && afterIsClean,
    deletedUserCount: userResults.filter((r) => r.outcome === 'deleted').length,
    skippedUserCount: userResults.filter((r) => r.outcome === 'already_clean').length,
    failedUserCount,
    userResults,
    before,
    after,
    deltas,
  }
}
