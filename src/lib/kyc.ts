// KYC / identity-verification workflow for SMART TRADE PRO.
//
// This is a SIMULATED verification flow for a university course project —
// it demonstrates a realistic user-submits / admin-reviews workflow, not
// real identity verification. Nothing here is checked against a real
// identity, government database, or third-party KYC provider; an admin
// just looks at whatever was uploaded and clicks Approve/Reject. See
// README.md's top-of-file notice: never upload a real government ID to
// this, even for testing — the files themselves are real uploads to a
// private Supabase Storage bucket (kyc-documents), gated by that bucket's
// storage policies to the submitting user and admins only — see
// SUPABASE_STORAGE_SETUP.md — but they are not treated as sensitive-enough
// to warrant collecting genuine documents in a course project.
//
// Storage provider note: this used to be Firebase Storage. That was
// abandoned because Google Cloud billing activation for this project
// repeatedly failed (OR_BACR2_31 / OR_BACR2_59) — Storage requires a
// billing-enabled project even on the free tier, Firestore/Auth/Hosting do
// not, and no amount of app-level configuration can work around a billing
// account rejection. Supabase Storage needs no such billing step. Firebase
// Auth, Firestore, and Hosting are completely unaffected by this — only
// the file bytes moved; every kycSubmissions Firestore document, status,
// and the admin review flow are unchanged.
//
// Firestore only ever stores a Storage *path* per document, never a
// download URL and never the file itself — see KycDocumentInfo in
// src/types/index.ts for why persisting a download URL would be unsafe.
// That was already true before this migration and needed no change: a
// Supabase signed URL is fetched fresh on demand (getKycFileUrl below),
// exactly like the old getDownloadURL() call it replaced.

import {
  collection,
  doc,
  runTransaction,
  serverTimestamp,
  setDoc,
  type Firestore,
} from 'firebase/firestore'
import { db } from './firebase'
import { isSupabaseConfigured, supabase, KYC_DOCUMENTS_BUCKET } from './supabase'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { KycDocumentInfo, KycDocumentType, KycStatus } from '../types'

/** 'not_started' is a UI-only concept — never stored in Firestore, it just means "no submission exists yet". */
export type KycDisplayStatus = KycStatus | 'not_started'

export const KYC_STATUS_META: Record<KycDisplayStatus, { label: string; tone: 'neutral' | 'gold' | 'success' | 'danger' }> = {
  not_started: { label: 'Not Verified', tone: 'neutral' },
  pending: { label: 'Verification Pending', tone: 'gold' },
  verified: { label: 'Verified', tone: 'success' },
  rejected: { label: 'Verification Rejected', tone: 'danger' },
}

export const KYC_DOC_TYPE_LABELS: Record<KycDocumentType, string> = {
  idCardFront: 'ID/PAN Card — Front',
  idCardBack: 'ID/PAN Card — Back',
  drivingLicenseFront: 'Driving License — Front',
  drivingLicenseBack: 'Driving License — Back',
}

export class KycError extends Error {}

function requireDb(): Firestore {
  if (!db) throw new KycError('Firebase is not configured yet — add your project keys to .env.')
  return db
}
function requireSupabaseStorage(): SupabaseClient {
  if (!isSupabaseConfigured || !supabase) {
    throw new KycError(
      'File storage is not configured yet — see SUPABASE_STORAGE_SETUP.md for the required .env values.',
    )
  }
  return supabase
}

// Images (JPG/PNG) are capped much tighter than PDFs — a phone photo of an
// ID has no real reason to exceed 1 MB, and keeping uploads small matters
// more here than for a scanned PDF, which can legitimately run larger.
// storage.rules enforces this exact same split server-side.
export const KYC_IMAGE_MAX_FILE_SIZE = 1 * 1024 * 1024 // 1 MB
export const KYC_PDF_MAX_FILE_SIZE = 10 * 1024 * 1024 // 10 MB
export const KYC_ID_DOC_ACCEPT = ['image/jpeg', 'image/png', 'application/pdf']

/** The two required government-ID document groups — both are required, each with a front and back side. */
export const KYC_ID_DOC_GROUPS = ['idCard', 'drivingLicense'] as const
export type KycIdDocGroup = (typeof KYC_ID_DOC_GROUPS)[number]

export const KYC_ID_DOC_GROUP_LABELS: Record<KycIdDocGroup, string> = {
  idCard: 'ID Card / PAN Card',
  drivingLicense: 'Driving License',
}

/** Returns a user-facing error message, or null if the file is acceptable. */
export function validateKycFile(file: File): string | null {
  if (!KYC_ID_DOC_ACCEPT.includes(file.type)) {
    return 'Document must be a JPG, PNG, or PDF file.'
  }
  const isPdf = file.type === 'application/pdf'
  if (isPdf) {
    if (file.size > KYC_PDF_MAX_FILE_SIZE) {
      return 'PDF is too large — the maximum size is 10 MB.'
    }
  } else if (file.size > KYC_IMAGE_MAX_FILE_SIZE) {
    return 'Image is too large — the maximum size is 1 MB.'
  }
  return null
}

export interface KycSubmissionFiles {
  idCardFront: File
  idCardBack: File
  // Driving License is optional — only the ID/PAN Card is required.
  drivingLicenseFront?: File
  drivingLicenseBack?: File
}

/** e.g. "photo.jpg" -> "jpg"; falls back to a mime-type-derived guess if the filename has no extension. */
function fileExtension(file: File): string {
  const match = /\.([a-zA-Z0-9]+)$/.exec(file.name)
  if (match) return match[1].toLowerCase()
  const fromMime = file.type.split('/')[1]
  return fromMime ? fromMime.replace('jpeg', 'jpg') : 'bin'
}

async function uploadOneFile(
  storageClient: SupabaseClient,
  uid: string,
  submissionId: string,
  docType: KycDocumentType,
  file: File,
  onProgress?: (docType: KycDocumentType, percent: number) => void,
): Promise<KycDocumentInfo> {
  // {docType}.{ext} rather than the raw uploaded filename — keeps the path
  // fully predictable/deterministic (matches the previous Firebase Storage
  // layout) and sidesteps having to sanitize an arbitrary user-supplied
  // filename for spaces/unicode/path separators.
  const storagePath = `kyc/${uid}/${submissionId}/${docType}.${fileExtension(file)}`

  // supabase-js's storage upload doesn't expose byte-level progress events
  // the way Firebase's uploadBytesResumable did — this is a coarse
  // 0% -> 100% instead of a smooth bar. Cosmetic only; upload
  // success/failure and the progress *prop* KycDocumentCard.tsx expects are
  // both preserved.
  onProgress?.(docType, 0)
  const { error } = await storageClient.storage
    .from(KYC_DOCUMENTS_BUCKET)
    .upload(storagePath, file, { contentType: file.type, upsert: true })
  if (error) {
    // Log the real Supabase error (message/name only — never file bytes) so
    // a storage-policy rejection, missing bucket, or misconfigured .env key
    // is diagnosable from the console instead of only showing the generic
    // user-facing message below.
    // eslint-disable-next-line no-console
    console.error(`[kyc] Supabase upload failed for ${docType}`, { message: error.message, name: error.name })
    throw new KycError(`Could not upload ${KYC_DOC_TYPE_LABELS[docType]} — please try again.`)
  }
  onProgress?.(docType, 100)

  return { uploaded: true, fileName: file.name, storagePath, uploadedAt: serverTimestamp() }
}

/**
 * Submits a new KYC verification attempt: validates every file, uploads
 * them to Storage, then writes one kycSubmissions doc with status
 * 'pending'. Callers are responsible for checking there's no already-
 * pending submission first (see useKycStatus) — that's a workflow
 * courtesy, not a security boundary, so it's enforced client-side, the
 * same way this app already handles "don't let a double-click submit
 * twice" elsewhere.
 */
// Only the ID/PAN Card is required — Driving License is optional.
const KYC_REQUIRED_DOC_TYPES: KycDocumentType[] = ['idCardFront', 'idCardBack']
const KYC_OPTIONAL_DOC_TYPES: KycDocumentType[] = ['drivingLicenseFront', 'drivingLicenseBack']

// Dev-only, stage-tagged tracing for the submit pipeline. Never logs file
// bytes/contents — only doc-type keys, file names, and error codes, so it's
// safe to leave in a shared/dev console. Silent in production builds.
function devLog(stage: string, detail?: unknown) {
  if (import.meta.env.DEV) {
    // eslint-disable-next-line no-console
    console.debug(`[kyc] ${stage}`, detail ?? '')
  }
}

export async function submitKycVerification(
  uid: string,
  email: string,
  files: KycSubmissionFiles,
  onProgress?: (docType: KycDocumentType, percent: number) => void,
): Promise<string> {
  const firestoreInstance = requireDb()
  const storageClient = requireSupabaseStorage()

  devLog('validating required documents', KYC_REQUIRED_DOC_TYPES)
  for (const key of KYC_REQUIRED_DOC_TYPES) {
    if (!files[key]) {
      throw new KycError(`Upload the ${KYC_DOC_TYPE_LABELS[key]} document.`)
    }
  }
  for (const key of KYC_REQUIRED_DOC_TYPES) {
    const err = validateKycFile(files[key]!)
    if (err) throw new KycError(err)
  }
  // Driving License is optional — only validate whichever side(s) were
  // actually provided.
  for (const key of KYC_OPTIONAL_DOC_TYPES) {
    const file = files[key]
    if (!file) continue
    const err = validateKycFile(file)
    if (err) throw new KycError(err)
  }

  const submissionRef = doc(collection(firestoreInstance, 'kycSubmissions'))
  const submissionId = submissionRef.id
  devLog('created submission id', submissionId)

  const uploaded: Partial<Record<KycDocumentType, KycDocumentInfo>> = {}
  for (const key of [...KYC_REQUIRED_DOC_TYPES, ...KYC_OPTIONAL_DOC_TYPES]) {
    const file = files[key]
    if (!file) continue
    devLog(`uploading ${key}`, { fileName: file.name, size: file.size, type: file.type })
    uploaded[key] = await uploadOneFile(storageClient, uid, submissionId, key, file, onProgress)
    devLog(`uploaded ${key}`, { storagePath: uploaded[key]!.storagePath })
  }

  devLog('writing kycSubmissions doc', submissionId)
  try {
    await setDoc(submissionRef, {
      userId: uid,
      userEmail: email,
      status: 'pending',
      idCardFront: uploaded.idCardFront,
      idCardBack: uploaded.idCardBack,
      drivingLicenseFront: uploaded.drivingLicenseFront ?? null,
      drivingLicenseBack: uploaded.drivingLicenseBack ?? null,
      submittedAt: serverTimestamp(),
      reviewedAt: null,
      reviewedBy: null,
      rejectionReason: null,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    })
  } catch (err) {
    // The files are already uploaded to Supabase at this point — only the
    // Firestore doc failed (e.g. rules rejected the write, or a network
    // blip). Surface the real cause to the console (error code/message
    // only, never file content) instead of letting a raw FirebaseError
    // escape uncaught, which the caller's non-KycError fallback would
    // otherwise flatten into an unhelpful generic message.
    // eslint-disable-next-line no-console
    console.error('[kyc] Firestore submission write failed', err)
    const code = typeof err === 'object' && err !== null && 'code' in err ? String((err as { code: unknown }).code) : null
    throw new KycError(
      code
        ? `Could not save your verification submission (${code}). Please try again.`
        : 'Could not save your verification submission. Please try again.',
    )
  }
  devLog('submission complete', submissionId)

  return submissionId
}

/**
 * Approves a pending submission. Wrapped in a transaction (like
 * src/lib/balanceRequests.ts's approve/reject) so a duplicate click or a
 * second admin acting at the same moment can't both succeed — whichever
 * transaction commits second sees status is no longer 'pending' and throws.
 */
export async function approveKycSubmission(adminUid: string, submissionId: string): Promise<void> {
  const firestoreInstance = requireDb()
  const ref_ = doc(firestoreInstance, 'kycSubmissions', submissionId)
  await runTransaction(firestoreInstance, async (transaction) => {
    const snapshot = await transaction.get(ref_)
    if (!snapshot.exists()) throw new KycError('Submission not found.')
    if (snapshot.data().status !== 'pending') throw new KycError('This submission has already been reviewed.')
    transaction.update(ref_, {
      status: 'verified',
      reviewedAt: serverTimestamp(),
      reviewedBy: adminUid,
      rejectionReason: null,
      updatedAt: serverTimestamp(),
    })
  })
}

/** Rejects a pending submission — a reason is required, shown to the user on their KYC page. */
export async function rejectKycSubmission(adminUid: string, submissionId: string, reason: string): Promise<void> {
  const trimmed = reason.trim()
  if (!trimmed) throw new KycError('A rejection reason is required.')

  const firestoreInstance = requireDb()
  const ref_ = doc(firestoreInstance, 'kycSubmissions', submissionId)
  await runTransaction(firestoreInstance, async (transaction) => {
    const snapshot = await transaction.get(ref_)
    if (!snapshot.exists()) throw new KycError('Submission not found.')
    if (snapshot.data().status !== 'pending') throw new KycError('This submission has already been reviewed.')
    transaction.update(ref_, {
      status: 'rejected',
      reviewedAt: serverTimestamp(),
      reviewedBy: adminUid,
      rejectionReason: trimmed,
      updatedAt: serverTimestamp(),
    })
  })
}

// How long a fetched viewing URL stays valid — long enough for an admin to
// actually look at a document (or a set of them) without it expiring
// mid-review, short enough that a copied/leaked link doesn't work forever.
const KYC_SIGNED_URL_TTL_SECONDS = 5 * 60 // 5 minutes

/**
 * Fetches a short-lived signed viewing URL for one uploaded file. Never
 * persist the result — fetch it fresh each time a document needs to be
 * displayed, exactly like AdminKycReviewModal.tsx does. This is the
 * Supabase equivalent of the old Firebase getDownloadURL() call: unlike a
 * Firebase download URL (a permanent bearer token), a Supabase signed URL
 * expires on its own after KYC_SIGNED_URL_TTL_SECONDS, so there's nothing
 * to revoke even if one were ever accidentally persisted somewhere.
 */
export async function getKycFileUrl(storagePath: string): Promise<string> {
  const storageClient = requireSupabaseStorage()
  const { data, error } = await storageClient.storage
    .from(KYC_DOCUMENTS_BUCKET)
    .createSignedUrl(storagePath, KYC_SIGNED_URL_TTL_SECONDS)
  if (error || !data?.signedUrl) {
    throw new KycError('Could not load this document — please try again.')
  }
  return data.signedUrl
}
