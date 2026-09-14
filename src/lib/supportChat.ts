// Real user↔admin support chat for SMART TRADE PRO.
//
// One thread per user at users/{uid}/supportChat/thread, with a messages
// subcollection. Every message a human being sees as "from a person" is
// still written by an actual signed-in person (the account owner, or a
// real admin replying from /admin/support) — there is no bot and nothing
// here ever generates a reply to anything a user says. The one exception is
// a single, fixed, non-generative acknowledgment sent automatically the
// moment a user's very first message opens a brand-new conversation (see
// sendSupportAutoReplyIfNeeded below) — after that, this file goes back to
// being purely a pass-through for real human messages, exactly as before.
//
// A message may also carry one uploaded image (see sendSupportMessage's
// `image` parameter) — the file itself lives in a private Supabase Storage
// bucket (support-attachments) at support/{uid}/{messageId}/{filename},
// never in Firestore; the message doc only ever stores the resulting
// storage path plus small metadata (see ChatImageFields below) — never a
// URL, since a private bucket's URL would just expire anyway. A text-only
// send never touches Storage at all, so it keeps working exactly as before
// even if Supabase is ever unavailable or unconfigured.
//
// Storage provider note: this used to be Firebase Storage
// (supportChatImages/{uid}/{messageId}, storing a persisted download URL
// directly in `imageUrl`). That was abandoned because Google Cloud billing
// activation for this project repeatedly failed (OR_BACR2_31 /
// OR_BACR2_59) — see src/lib/kyc.ts for the same note. `imageUrl` is kept
// in the schema as a read-only legacy field so any old message that
// happened to get one before the migration keeps displaying correctly
// (see SupportChatThread.tsx) — new messages only ever write `imagePath`.

import {
  collection,
  doc,
  getDoc,
  getDocs,
  runTransaction,
  serverTimestamp,
  setDoc,
  writeBatch,
  type DocumentReference,
  type Firestore,
} from 'firebase/firestore'
import { db } from './firebase'
import { isSupabaseConfigured, supabase, SUPPORT_ATTACHMENTS_BUCKET } from './supabase'
import type { SupabaseClient } from '@supabase/supabase-js'

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

// {uid} doubles as the "conversation id" here — this schema has exactly one
// thread per user, so the user's own uid already uniquely identifies their
// one conversation; there's no separate conversation id to introduce.
function chatImageStoragePath(uid: string, messageId: string, fileName: string) {
  return `support/${uid}/${messageId}/${sanitizeFileName(fileName)}`
}

/** Strips characters that are awkward or unsafe in a storage path/URL, keeping the name recognizable. */
function sanitizeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_') || 'image'
}

// Not a real Firebase Auth uid — a fixed placeholder id so a system message
// can never be mistaken for (or collide with) anything a real person sent.
const SYSTEM_SENDER_ID = 'system'

/**
 * The one-time automatic first-contact acknowledgment. Fixed, exact text —
 * never generated, never templated per-user. Blank lines are meaningful
 * paragraph breaks: SupportChatThread.tsx already renders message text with
 * `whitespace-pre-wrap`, so these are preserved exactly as written here.
 */
export const SUPPORT_AUTO_REPLY_MESSAGE = `Our mission is to provide a secure, transparent, and professional trading environment for users worldwide. The platform is designed to help you trade smoothly, manage your assets efficiently, and grow your investments with confidence.

If you are new to the platform, we recommend exploring the available features and completing your profile setup.

Your chat has been forwarded to a SmartTradePro Customer Support representative. We kindly ask for your patience, as all of our representatives are currently assisting other customers. A representative will be with you as soon as one becomes available.

If you have any questions or require assistance, our SmartTradePro Customer Support team is always here to help.

We truly appreciate your trust in SmartTradePro and look forward to supporting your success.

SmartTradePro Support Team`

// Images only — chat attachments are screenshots/photos, never PDFs. Capped
// tight for the same reason src/lib/kyc.ts caps its own images at 1 MB: a
// phone photo or screenshot has no legitimate reason to exceed it. The
// support-attachments bucket's storage policies (SUPABASE_STORAGE_SETUP.md)
// enforce this exact same cap server-side.
export const SUPPORT_CHAT_IMAGE_ACCEPT = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
export const SUPPORT_CHAT_IMAGE_MAX_SIZE = 1 * 1024 * 1024 // 1 MB

/** Returns a user-facing error message, or null if the file is acceptable to attach. */
export function validateSupportChatImage(file: File): string | null {
  if (!file.type || !SUPPORT_CHAT_IMAGE_ACCEPT.includes(file.type)) {
    return 'Only JPG, PNG, WEBP, and GIF images are supported.'
  }
  if (file.size <= 0) {
    return 'That file appears to be empty — choose a different image.'
  }
  if (file.size > SUPPORT_CHAT_IMAGE_MAX_SIZE) {
    return 'Image must be smaller than 1 MB.'
  }
  return null
}

interface ChatImageFields {
  type: 'image'
  imagePath: string
  imageName: string
  imageSize: number
  imageContentType: string
}

/**
 * Uploads one chat image and returns the fields to merge into its message
 * doc. Never called for a text-only send — see sendSupportMessage — so a
 * missing/unconfigured Supabase project (see SUPABASE_STORAGE_SETUP.md) can
 * never affect normal chat. Any failure here is re-thrown as a plain,
 * friendly SupportChatError rather than the raw Supabase SDK error,
 * matching how every other error in this app is translated before it
 * reaches a user (see src/lib/authErrors.ts) — the caller keeps the
 * selected image and lets them retry either way.
 */
async function uploadSupportChatImage(
  storageClient: SupabaseClient,
  uid: string,
  messageId: string,
  file: File,
): Promise<ChatImageFields> {
  const storagePath = chatImageStoragePath(uid, messageId, file.name)
  const { error } = await storageClient.storage
    .from(SUPPORT_ATTACHMENTS_BUCKET)
    .upload(storagePath, file, { contentType: file.type, upsert: false })
  if (error) {
    throw new SupportChatError('Could not upload image — please try again.')
  }
  return { type: 'image', imagePath: storagePath, imageName: file.name, imageSize: file.size, imageContentType: file.type }
}

// How long a fetched viewing URL stays valid — see src/lib/kyc.ts's own
// KYC_SIGNED_URL_TTL_SECONDS for the same reasoning. Long enough that a
// chat thread full of images doesn't need to keep re-signing while someone
// is actively reading it, short enough that a copied link doesn't work forever.
const SUPPORT_CHAT_SIGNED_URL_TTL_SECONDS = 60 * 60 // 1 hour

/**
 * Fetches a short-lived signed viewing URL for one chat image, given the
 * `imagePath` stored on its message doc. Never persist the result — called
 * fresh by SupportChatThread.tsx each time a thread loads. This is the
 * Supabase counterpart to src/lib/kyc.ts's getKycFileUrl.
 */
export async function getSupportChatImageUrl(storagePath: string): Promise<string> {
  if (!isSupabaseConfigured || !supabase) {
    throw new SupportChatError('File storage is not configured yet — see SUPABASE_STORAGE_SETUP.md.')
  }
  const { data, error } = await supabase.storage
    .from(SUPPORT_ATTACHMENTS_BUCKET)
    .createSignedUrl(storagePath, SUPPORT_CHAT_SIGNED_URL_TTL_SECONDS)
  if (error || !data?.signedUrl) {
    throw new SupportChatError('Could not load this image.')
  }
  return data.signedUrl
}

/**
 * Sends one chat message and updates the thread's denormalized preview
 * fields (lastMessage/lastMessageAt/lastSenderRole). Those preview fields
 * are what let AdminSupport.tsx list "who has an active thread, most
 * recent first" with one cheap collectionGroup('supportChat') query
 * instead of scanning every message of every user.
 *
 * `image`, when provided, is validated and uploaded to Storage BEFORE
 * anything is written to Firestore — if the upload fails, this throws and
 * no message doc is ever created (never a "broken" message with a caption
 * but no image, or vice versa). A text-only send (`image` omitted) never
 * touches Storage at all, so it keeps working even if Storage is
 * unavailable or misconfigured.
 *
 * A message from the user additionally triggers the one-time auto-reply
 * (see sendSupportAutoReplyIfNeeded) when — and only when — this message is
 * opening a genuinely brand-new conversation. An admin's own reply never
 * triggers it, and neither does any later message in a thread that already
 * exists (including one that predates this feature entirely, or one that
 * already happens to contain this exact text from an earlier attempt) —
 * see `isNewThread` below. An image-only first message (no caption) counts
 * as a normal user message for this exactly the same way a text one does.
 */
export async function sendSupportMessage(
  uid: string,
  senderId: string,
  senderRole: 'user' | 'admin',
  text: string,
  image?: File,
): Promise<void> {
  const firestore = requireDb()
  const trimmed = text.trim()
  if (!trimmed && !image) {
    throw new SupportChatError('Message cannot be empty.')
  }

  if (image) {
    const validationError = validateSupportChatImage(image)
    if (validationError) throw new SupportChatError(validationError)
    if (!isSupabaseConfigured || !supabase) {
      throw new SupportChatError('Image upload is not available right now — see SUPABASE_STORAGE_SETUP.md.')
    }
  }

  const threadRef = getThreadRef(firestore, uid)

  // Checked BEFORE writing anything, since sending the message below is
  // what actually creates the thread doc for a first-ever message. This
  // plain read is just an optimization to skip the auto-reply entirely for
  // any thread that already exists (old or new) — it is NOT itself what
  // prevents a duplicate under a race; see the transaction below for that.
  let isNewThread = false
  if (senderRole === 'user') {
    try {
      const existingThread = await getDoc(threadRef)
      isNewThread = !existingThread.exists()
    } catch {
      // If this check fails for any reason, fall through as "not new" —
      // sending the user's own message must never be blocked by it.
    }
  }

  // Pre-generated so the image (if any) can be uploaded to a path that
  // names this exact message BEFORE the message doc itself is written —
  // that ordering is what guarantees a message never gets created without
  // its image having actually finished uploading first.
  const messageRef = doc(collection(threadRef, 'messages'))

  let imageFields: ChatImageFields | null = null
  if (image) {
    imageFields = await uploadSupportChatImage(supabase!, uid, messageRef.id, image)
  }

  const previewText = trimmed || (imageFields ? '📷 Photo' : '')

  await Promise.all([
    setDoc(messageRef, {
      senderId,
      senderRole,
      text: trimmed,
      timestamp: serverTimestamp(),
      ...(imageFields && {
        type: imageFields.type,
        imagePath: imageFields.imagePath,
        imageName: imageFields.imageName,
        imageSize: imageFields.imageSize,
        imageContentType: imageFields.imageContentType,
      }),
    }),
    setDoc(
      threadRef,
      { uid, lastMessage: previewText, lastMessageAt: serverTimestamp(), lastSenderRole: senderRole },
      { merge: true },
    ),
  ])

  if (isNewThread) {
    try {
      await sendSupportAutoReplyIfNeeded(firestore, uid, threadRef)
    } catch {
      // Best-effort, same as cleanupStaleThreadIfNeeded below — the user's
      // own message above already sent successfully either way; a
      // transient failure here just means no auto-reply shows up this time.
    }
  }
}

/**
 * Sends the one-time automatic acknowledgment for a brand-new conversation.
 * Safe to call concurrently any number of times for the same thread (rapid
 * double-send, two tabs open at once, etc.) — the transaction re-reads
 * `autoReplySent` fresh at commit time and only ever writes if it's still
 * not true, so Firestore's own optimistic-concurrency control guarantees
 * exactly one of any number of simultaneous attempts can actually win: every
 * other one is transparently retried by the SDK, sees the flag the winner
 * just set, and writes nothing. This is the actual duplicate-prevention
 * guarantee (not the `isNewThread` pre-check in the caller above, which is
 * only an optimization).
 *
 * Runs strictly after the user's own message has already been written (see
 * the caller), so its serverTimestamp() resolves to a later real commit
 * time than the user's message — that's what keeps this appearing after it
 * in the timeline, rather than the two ever tying (two serverTimestamp()
 * sentinels written inside the very same transaction/batch would resolve to
 * the identical commit time, which is why this is deliberately a separate,
 * later transaction rather than folded into the write above).
 */
async function sendSupportAutoReplyIfNeeded(
  firestore: Firestore,
  uid: string,
  threadRef: DocumentReference,
): Promise<void> {
  await runTransaction(firestore, async (transaction) => {
    const snapshot = await transaction.get(threadRef)
    if (snapshot.data()?.autoReplySent === true) return // Someone else's concurrent attempt already won.

    transaction.set(doc(collection(threadRef, 'messages')), {
      senderId: SYSTEM_SENDER_ID,
      senderRole: 'system',
      text: SUPPORT_AUTO_REPLY_MESSAGE,
      timestamp: serverTimestamp(),
    })
    transaction.set(
      threadRef,
      {
        uid,
        lastMessage: SUPPORT_AUTO_REPLY_MESSAGE,
        lastMessageAt: serverTimestamp(),
        lastSenderRole: 'system',
        autoReplySent: true,
      },
      { merge: true },
    )
  })
}

/**
 * Best-effort client-triggered cleanup: if a thread's most recent message
 * is older than 7 days, wipes every message in it (and the thread summary
 * doc) — including deleting each message's uploaded image from Storage, if
 * it has one, so a stale-thread sweep doesn't leave orphaned files behind.
 * This only runs when someone actually opens Support.tsx or
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

  if (isSupabaseConfigured && supabase) {
    // Only new-schema messages (imagePath) have anything to delete here — a
    // legacy message with just an `imageUrl` was a Firebase Storage file
    // from before this migration, long since unreachable either way, so
    // there's nothing for Supabase to clean up for it.
    const pathsToRemove = messagesSnapshot.docs
      .map((docSnapshot) => docSnapshot.data())
      .filter((data) => data.type === 'image' && typeof data.imagePath === 'string')
      .map((data) => data.imagePath as string)
    if (pathsToRemove.length > 0) {
      await supabase.storage.from(SUPPORT_ATTACHMENTS_BUCKET).remove(pathsToRemove).catch(() => {
        // Non-fatal — worst case, some orphaned files are left behind; the
        // Firestore cleanup below still proceeds either way.
      })
    }
  }

  for (let i = 0; i < messagesSnapshot.docs.length; i += BATCH_SIZE) {
    const batch = writeBatch(firestore)
    messagesSnapshot.docs.slice(i, i + BATCH_SIZE).forEach((docSnapshot) => batch.delete(docSnapshot.ref))
    if (i === 0) batch.delete(threadRef) // Clear the summary doc too, in the first chunk.
    await batch.commit()
  }

  return true
}
