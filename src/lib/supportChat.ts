// Real user↔admin support chat for SMART TRADE PRO.
//
// One thread per user at users/{uid}/supportChat/thread, with a messages
// subcollection. There is no bot, no auto-reply, and no simulated agent
// anywhere in this file — every message is written by an actual signed-in
// person (the account owner, or a real admin replying from /admin/support).

import { addDoc, collection, doc, getDoc, getDocs, serverTimestamp, setDoc, writeBatch } from 'firebase/firestore'
import { db } from './firebase'

export class SupportChatError extends Error {}

function requireDb() {
  if (!db) {
    throw new SupportChatError('Firebase is not configured yet — add your project keys to .env.')
  }
  return db
}

const THREAD_DOC_ID = 'thread'
const STALE_THREAD_MS = 7 * 24 * 60 * 60 * 1000 // 7 days
const BATCH_SIZE = 500 // Firestore's per-batch write cap.

function getThreadRef(firestore: NonNullable<typeof db>, uid: string) {
  return doc(firestore, 'users', uid, 'supportChat', THREAD_DOC_ID)
}

/**
 * Sends one chat message and updates the thread's denormalized preview
 * fields (lastMessage/lastMessageAt/lastSenderRole). Those preview fields
 * are what let AdminSupport.tsx list "who has an active thread, most
 * recent first" with one cheap collectionGroup('supportChat') query
 * instead of scanning every message of every user.
 */
export async function sendSupportMessage(
  uid: string,
  senderId: string,
  senderRole: 'user' | 'admin',
  text: string,
): Promise<void> {
  const firestore = requireDb()
  const trimmed = text.trim()
  if (!trimmed) {
    throw new SupportChatError('Message cannot be empty.')
  }

  const threadRef = getThreadRef(firestore, uid)

  await Promise.all([
    addDoc(collection(threadRef, 'messages'), {
      senderId,
      senderRole,
      text: trimmed,
      timestamp: serverTimestamp(),
    }),
    setDoc(
      threadRef,
      { uid, lastMessage: trimmed, lastMessageAt: serverTimestamp(), lastSenderRole: senderRole },
      { merge: true },
    ),
  ])
}

/**
 * Best-effort client-triggered cleanup: if a thread's most recent message
 * is older than 7 days, wipes every message in it (and the thread summary
 * doc). This only runs when someone actually opens Support.tsx or
 * AdminSupport.tsx for that thread — it is NOT a guaranteed server-side
 * schedule. A real production app would use a scheduled Cloud Function
 * (Cloud Scheduler + Firestore) to guarantee this runs on a timer
 * regardless of whether anyone ever opens the page again; that requires
 * Firebase's paid Blaze plan, which is out of scope here.
 *
 * Returns true if a cleanup actually happened.
 */
export async function cleanupStaleThreadIfNeeded(uid: string): Promise<boolean> {
  const firestore = requireDb()
  const threadRef = getThreadRef(firestore, uid)

  const threadSnapshot = await getDoc(threadRef)
  const lastMessageAt = threadSnapshot.data()?.lastMessageAt
  if (!lastMessageAt || typeof lastMessageAt.toMillis !== 'function') {
    return false // No messages yet, or the field hasn't resolved server-side yet.
  }

  const age = Date.now() - lastMessageAt.toMillis()
  if (age < STALE_THREAD_MS) return false

  const messagesSnapshot = await getDocs(collection(threadRef, 'messages'))
  if (messagesSnapshot.empty) return false

  for (let i = 0; i < messagesSnapshot.docs.length; i += BATCH_SIZE) {
    const batch = writeBatch(firestore)
    messagesSnapshot.docs.slice(i, i + BATCH_SIZE).forEach((docSnapshot) => batch.delete(docSnapshot.ref))
    if (i === 0) batch.delete(threadRef) // Clear the summary doc too, in the first chunk.
    await batch.commit()
  }

  return true
}
