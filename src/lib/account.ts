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
import { collection, deleteDoc, doc, getDocs, updateDoc, writeBatch } from 'firebase/firestore'
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

const SUBCOLLECTIONS_TO_DELETE = ['transactions', 'portfolioSnapshots'] as const
const BATCH_SIZE = 500 // Firestore's per-batch write cap.

/**
 * Permanently deletes the signed-in user's own account: their Firestore
 * profile doc, every document in its transactions and portfolioSnapshots
 * subcollections, and finally the Firebase Auth user itself.
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

  const credential = EmailAuthProvider.credential(user.email, currentPassword)
  await reauthenticateWithCredential(user, credential)

  const userRef = doc(firestore, 'users', user.uid)

  for (const subcollectionName of SUBCOLLECTIONS_TO_DELETE) {
    const snapshot = await getDocs(collection(userRef, subcollectionName))
    for (let i = 0; i < snapshot.docs.length; i += BATCH_SIZE) {
      const batch = writeBatch(firestore)
      snapshot.docs.slice(i, i + BATCH_SIZE).forEach((docSnapshot) => batch.delete(docSnapshot.ref))
      await batch.commit()
    }
  }

  await deleteDoc(userRef)
  await deleteUser(user)
}
