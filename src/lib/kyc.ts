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
  idCard: 'ID Card',
  drivingLicense: 'Driving License',
  passport: 'Passport',
  photo: 'Photo',
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
// ID or a selfie has no real reason to exceed 1 MB, and keeping uploads
// small matters more here than for a scanned PDF, which can legitimately
// run larger. storage.rules enforces this exact same split server-side.
export const KYC_IMAGE_MAX_FILE_SIZE = 1 * 1024 * 1024 // 1 MB
export const KYC_PDF_MAX_FILE_SIZE = 10 * 1024 * 1024 // 10 MB
export const KYC_ID_DOC_ACCEPT = ['image/jpeg', 'image/png', 'application/pdf']
export const KYC_PHOTO_ACCEPT = ['image/jpeg', 'image/png']

/** The three alternative government-ID document types — a submission needs exactly one of them. */
export const KYC_ID_DOC_TYPES = ['idCard', 'drivingLicense', 'passport'] as const
export type KycIdDocType = (typeof KYC_ID_DOC_TYPES)[number]

/** Returns a user-facing error message, or null if the file is acceptable. */
export function validateKycFile(file: File, kind: 'id' | 'photo'): string | null {
  const allowed = kind === 'photo' ? KYC_PHOTO_ACCEPT : KYC_ID_DOC_ACCEPT
  if (!allowed.includes(file.type)) {
    return kind === 'photo' ? 'Photo must be a JPG or PNG image.' : 'Document must be a JPG, PNG, or PDF file.'
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
  idCard?: File
  drivingLicense?: File
  passport?: File
  photo: File
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
  if (error) throw new KycError(`Could not upload ${KYC_DOC_TYPE_LABELS[docType]} — please try again.`)
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
export async function submitKycVerification(
  uid: string,
  email: string,
  files: KycSubmissionFiles,
  onProgress?: (docType: KycDocumentType, percent: number) => void,
): Promise<string> {
  const firestoreInstance = requireDb()
  const storageClient = requireSupabaseStorage()

  const providedIdTypes = KYC_ID_DOC_TYPES.filter((key) => files[key])
  if (providedIdTypes.length === 0) {
    throw new KycError('Upload at least one government-issued ID: an ID Card, Driving License, or Passport.')
  }
  if (!files.photo) {
    throw new KycError('Upload your verification photo.')
  }

  for (const key of providedIdTypes) {
    const err = validateKycFile(files[key]!, 'id')
    if (err) throw new KycError(err)
  }
  const photoError = validateKycFile(files.photo, 'photo')
  if (photoError) throw new KycError(photoError)

  const submissionRef = doc(collection(firestoreInstance, 'kycSubmissions'))
  const submissionId = submissionRef.id

  const idDocs: Record<KycIdDocType, KycDocumentInfo | null> = { idCard: null, drivingLicense: null, passport: null }
  for (const key of providedIdTypes) {
    idDocs[key] = await uploadOneFile(storageClient, uid, submissionId, key, files[key]!, onProgress)
  }
  const photoInfo = await uploadOneFile(storageClient, uid, submissionId, 'photo', files.photo, onProgress)

  await setDoc(submissionRef, {
    userId: uid,
    userEmail: email,
    status: 'pending',
    idCard: idDocs.idCard,
    drivingLicense: idDocs.drivingLicense,
    passport: idDocs.passport,
    photo: photoInfo,
    submittedAt: serverTimestamp(),
    reviewedAt: null,
    reviewedBy: null,
    rejectionReason: null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })

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
