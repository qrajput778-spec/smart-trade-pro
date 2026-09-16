/**
 * SMART TRADE PRO — minimal server-side backend.
 *
 * This project is otherwise entirely frontend + Firebase Auth/Firestore +
 * Supabase Storage (see the root README.md and SUPABASE_STORAGE_SETUP.md).
 * It exists ONLY because of one specific, unavoidable limitation: deleting a
 * DIFFERENT user's Firebase Authentication account requires the Admin SDK,
 * which must run on a trusted server — a signed-in browser client, even an
 * admin's, can never do this itself (the client SDK can only ever delete
 * the CURRENTLY signed-in user's own account, via deleteUser(auth.currentUser),
 * exactly what src/lib/account.ts's own deleteAccount already does for a
 * user removing themselves).
 *
 * Everything else about "Remove User" (deleting the target's Firestore
 * profile, trades, KYC submissions, balance requests, support chat, and
 * their Supabase Storage files) still runs client-side from
 * src/lib/admin.ts, exactly as before — that's all data the admin's own
 * authenticated client already has permission to touch under
 * firestore.rules. This function's only job is the one piece that's
 * structurally impossible otherwise: actually revoking the target's ability
 * to ever sign in again.
 *
 * No service-account JSON or private key lives here or anywhere in this
 * repo — initializeApp() with no arguments uses Application Default
 * Credentials, which Cloud Functions' own managed runtime provides
 * automatically. Nothing here is ever bundled into the Vite frontend; this
 * is a separate Node project deployed straight to Cloud Functions.
 */

import { setGlobalOptions } from 'firebase-functions/v2'
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import * as logger from 'firebase-functions/logger'
import * as admin from 'firebase-admin'

admin.initializeApp()

// Keeps cold-start cost/quota predictable for a tool only admins ever click —
// this is not a high-traffic endpoint.
setGlobalOptions({ maxInstances: 5 })

interface DeleteUserAuthAccountRequest {
  targetUid: string
}

interface DeleteUserAuthAccountResponse {
  success: true
  /** True if the Auth account was already gone (e.g. a retried call after a prior success) — still a success either way. */
  alreadyDeleted: boolean
}

/**
 * Callable function: permanently deletes ONE target user's Firebase
 * Authentication account. Requires the caller to be signed in AND to have
 * `isAdmin: true` on their own Firestore users/{uid} doc — re-checked here
 * with the Admin SDK (which bypasses firestore.rules entirely) because that
 * check is the ONLY server-side gate this endpoint has; the client-side
 * AdminRoute guard is a UX convenience, never a security boundary on its own.
 *
 * Refuses to ever delete:
 *  - the caller's own account (self-deletion goes through Settings instead,
 *    src/lib/account.ts's deleteAccount, which uses the client SDK's own
 *    deleteUser(auth.currentUser) — no Admin SDK needed for that case)
 *  - another admin account (mirrors the exact same protection firestore.rules
 *    already applies to the client-side Firestore cleanup in
 *    src/lib/admin.ts's removeUserAccount, via isAdminAccount())
 *
 * Idempotent: calling this again for a uid whose Auth account is already
 * gone (e.g. the client retrying after a Firestore-cleanup step failed on a
 * previous attempt) returns success with `alreadyDeleted: true` rather than
 * throwing — see src/lib/admin.ts's removeUserAccount for why that matters.
 */
export const deleteUserAuthAccount = onCall<DeleteUserAuthAccountRequest, Promise<DeleteUserAuthAccountResponse>>(
  async (request) => {
    const callerUid = request.auth?.uid
    if (!callerUid) {
      throw new HttpsError('unauthenticated', 'You must be signed in.')
    }

    const targetUid = request.data?.targetUid
    if (typeof targetUid !== 'string' || targetUid.trim().length === 0) {
      throw new HttpsError('invalid-argument', 'targetUid is required.')
    }

    if (targetUid === callerUid) {
      throw new HttpsError(
        'failed-precondition',
        'You cannot delete your own account from the admin panel — use Settings instead.',
      )
    }

    const firestore = admin.firestore()

    const callerSnapshot = await firestore.collection('users').doc(callerUid).get()
    if (!callerSnapshot.exists || callerSnapshot.data()?.isAdmin !== true) {
      // Logged with uids only — never email, never any profile content.
      logger.warn('deleteUserAuthAccount: non-admin caller rejected', { callerUid })
      throw new HttpsError('permission-denied', 'Only an admin can perform this action.')
    }

    // If the target still has a Firestore profile, never let this delete an
    // admin account through here — same rule the client-side cleanup
    // already enforces, kept here too since this is the actual security
    // boundary (the client-side check alone is not one).
    const targetSnapshot = await firestore.collection('users').doc(targetUid).get()
    if (targetSnapshot.exists && targetSnapshot.data()?.isAdmin === true) {
      throw new HttpsError('failed-precondition', 'Another admin account cannot be removed from here.')
    }

    try {
      await admin.auth().deleteUser(targetUid)
      logger.info('deleteUserAuthAccount: deleted', { callerUid, targetUid })
      return { success: true, alreadyDeleted: false }
    } catch (err) {
      const code = typeof err === 'object' && err !== null && 'code' in err ? String((err as { code: unknown }).code) : null
      if (code === 'auth/user-not-found') {
        // Already deleted — most likely a retry after a previous call's
        // Auth deletion succeeded but the client's own Firestore/Storage
        // cleanup afterward failed partway. Safe to treat as success so the
        // client can proceed to (re-)finish that cleanup.
        logger.info('deleteUserAuthAccount: target already deleted, treating as success', { callerUid, targetUid })
        return { success: true, alreadyDeleted: true }
      }
      // Never log the error's own message/stack here — some Admin SDK
      // errors can echo back request details. The `code` alone is enough to
      // diagnose from the Cloud Functions log without risking that.
      logger.error('deleteUserAuthAccount: admin.auth().deleteUser failed', { callerUid, targetUid, code })
      throw new HttpsError('internal', 'Could not delete the Firebase Authentication account. Please try again.')
    }
  },
)
