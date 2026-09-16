// Account management (profile, security, danger zone) for SMART TRADE PRO.
//
// Every function here acts only on the signed-in user's own Firebase Auth
// account and their own users/{uid} Firestore document — no admin access,
// no other user's data is ever touched.

import {
  EmailAuthProvider,
  deleteUser,
  reauthenticateWithCredential,
  updatePassword,
  updateProfile,
  type User as FirebaseUser,
} from 'firebase/auth'
import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  updateDoc,
  writeBatch,
  type DocumentReference,
  type QueryDocumentSnapshot,
} from 'firebase/firestore'
import { db } from './firebase'

/** Thrown for expected, user-facing account problems — its message is safe to show directly. */
export class AccountError extends Error {}

function requireDb() {
  if (!db) {
    throw new AccountError('Firebase is not configured yet — add your project keys to .env.')
  }
  return db
}

/** Updates the display name in both Firebase Auth and the Firestore profile doc so they can't drift apart. */
export async function updateDisplayName(user: FirebaseUser, displayName: string): Promise<void> {
  const firestore = requireDb()
  const trimmed = displayName.trim()
  if (!trimmed) throw new AccountError('Display name cannot be empty.')

  await updateProfile(user, { displayName: trimmed })
  await updateDoc(doc(firestore, 'users', user.uid), { displayName: trimmed })
}

/** Re-authenticates with the current password, then sets the new one. */
export async function changePassword(
  user: FirebaseUser,
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  if (!user.email) throw new AccountError('Your account has no email on file.')
  const credential = EmailAuthProvider.credential(user.email, currentPassword)
  await reauthenticateWithCredential(user, credential)
  await updatePassword(user, newPassword)
}

// Every direct, flat subcollection of users/{uid} that has no children of
// its own — see firestore.rules' schema comment for the full list of what
// lives under a user doc. `supportChat` is deliberately NOT here: each of
// its documents (the fixed-id `thread` doc) has its own `messages`
// subcollection nested underneath, which needs its own pass first (see
// deleteSupportChat below) — Firestore never cascades a delete into a
// subcollection when its parent document is deleted.
const FLAT_SUBCOLLECTIONS_TO_DELETE = ['transactions', 'portfolioSnapshots', 'timedTrades'] as const
const BATCH_SIZE = 500 // Firestore's per-batch write cap.

/** Deletes every document directly inside `parentRef/subcollectionName`, chunked to Firestore's batch limit. */
async function deleteSubcollectionDocs(
  firestore: ReturnType<typeof requireDb>,
  parentRef: DocumentReference,
  subcollectionName: string,
): Promise<QueryDocumentSnapshot[]> {
  const snapshot = await getDocs(collection(parentRef, subcollectionName))
  for (let i = 0; i < snapshot.docs.length; i += BATCH_SIZE) {
    const batch = writeBatch(firestore)
    snapshot.docs.slice(i, i + BATCH_SIZE).forEach((docSnapshot) => batch.delete(docSnapshot.ref))
    await batch.commit()
  }
  return snapshot.docs
}

/**
 * Deletes a user's supportChat subtree: each thread doc's own `messages`
 * subcollection first (there's normally exactly one thread, fixed id
 * 'thread' — see src/lib/supportChat.ts — but this doesn't assume that),
 * then the thread doc(s) themselves. Skipping the nested `messages` pass
 * would leave every real chat message (and the one automatic system
 * acknowledgment) orphaned under the deleted user's uid forever, since
 * Firestore doesn't cascade deletes into subcollections.
 */
async function deleteSupportChat(firestore: ReturnType<typeof requireDb>, userRef: DocumentReference): Promise<void> {
  const threadDocs = await getDocs(collection(userRef, 'supportChat'))
  for (const threadDoc of threadDocs.docs) {
    await deleteSubcollectionDocs(firestore, threadDoc.ref, 'messages')
  }
  await deleteSubcollectionDocs(firestore, userRef, 'supportChat')
}

/**
 * Permanently deletes the signed-in user's own account: every document in
 * their transactions/portfolioSnapshots/timedTrades/supportChat (incl. its
 * nested messages) subcollections, their Firestore profile doc (which also
 * carries balance, holdings, shorts, and watchlist as plain fields — no
 * separate subcollection needed for those), and finally the Firebase Auth
 * user itself.
 *
 * balanceRequests and kycSubmissions are deliberately left untouched: both
 * are permanent, top-level records by design (`allow delete: if false` in
 * firestore.rules, matching how admin-side deletion works too) — a deposit/
 * withdrawal or KYC decision stays auditable even after the account that
 * filed it is gone. There is no client-safe way to remove them, and no
 * server-side component in this project to do it another way.
 *
 * NOTE: this fetch-then-batch-delete approach runs entirely client-side,
 * which is fine here because it only ever runs for a signed-in user acting
 * on their own small amount of test-project data. A real production app
 * should do this server-side instead (e.g. a Cloud Function triggered on
 * Auth user deletion, or a scheduled cleanup job) so it's atomic, isn't
 * capped by what a browser tab can hold in memory, and can't be left
 * half-finished by a closed tab or lost connection partway through.
 */
export async function deleteAccount(user: FirebaseUser, currentPassword: string): Promise<void> {
  const firestore = requireDb()
  if (!user.email) throw new AccountError('Your account has no email on file.')

  // Firebase Auth requires a RECENT sign-in for a sensitive operation like
  // deleteUser() below — rather than let that call fail with
  // auth/requires-recent-login after all the Firestore cleanup already ran,
  // reauthenticate up front with the password the user just typed into this
  // same dialog, so a wrong password fails fast with a clear message and
  // nothing is deleted yet.
  const credential = EmailAuthProvider.credential(user.email, currentPassword)
  await reauthenticateWithCredential(user, credential)

  const userRef = doc(firestore, 'users', user.uid)

  for (const subcollectionName of FLAT_SUBCOLLECTIONS_TO_DELETE) {
    await deleteSubcollectionDocs(firestore, userRef, subcollectionName)
  }
  await deleteSupportChat(firestore, userRef)

  await deleteDoc(userRef)
  await deleteUser(user)
}
