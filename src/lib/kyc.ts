// KYC / identity-verification workflow for SMART TRADE PRO.
//
// This is a SIMULATED verification flow for a university course project —
// it demonstrates a realistic user-submits / admin-reviews workflow, not
// real identity verification. Nothing here is checked against a real
// identity, government database, or third-party KYC provider; an admin
// just looks at whatever was uploaded and clicks Approve/Reject. See
// README.md's top-of-file notice: never upload a real government ID to
// this, even for testing — the files themselves are real uploads to a
// real Firebase Storage bucket, gated by storage.rules to the submitting
// user and admins only, but they are not treated as sensitive-enough to
// warrant collecting genuine documents in a course project.
//
// Firestore only ever stores a Storage *path* per document, never a
// download URL and never the file itself — see KycDocumentInfo in
// src/types/index.ts for why persisting a download URL would be unsafe.

import {
  collection,
  doc,
  runTransaction,
  serverTimestamp,
  setDoc,
  type Firestore,
} from 'firebase/firestore'
import { getDownloadURL, ref, uploadBytesResumable, type FirebaseStorage } from 'firebase/storage'
import { db, storage } from './firebase'
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
function requireStorage(): FirebaseStorage {
  if (!storage) throw new KycError('Firebase Storage is not configured yet — add your project keys to .env.')
  return storage
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

async function uploadOneFile(
  storageInstance: FirebaseStorage,
  uid: string,
  submissionId: string,
  docType: KycDocumentType,
  file: File,
  onProgress?: (docType: KycDocumentType, percent: number) => void,
): Promise<KycDocumentInfo> {
  const storagePath = `kyc/${uid}/${submissionId}/${docType}`
  const fileRef = ref(storageInstance, storagePath)

  await new Promise<void>((resolve, reject) => {
    const task = uploadBytesResumable(fileRef, file, { contentType: file.type })
    task.on(
      'state_changed',
      (snapshot) => {
        const percent = snapshot.totalBytes > 0 ? Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100) : 0
        onProgress?.(docType, percent)
      },
      (err) => reject(err),
      () => resolve(),
    )
  })

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
  const storageInstance = requireStorage()

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
    idDocs[key] = await uploadOneFile(storageInstance, uid, submissionId, key, files[key]!, onProgress)
  }
  const photoInfo = await uploadOneFile(storageInstance, uid, submissionId, 'photo', files.photo, onProgress)

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

/**
 * Fetches a short-lived viewing URL for one uploaded file, gated by
 * storage.rules at the moment of the call (owner or admin only). Never
 * persist the result — fetch it fresh each time a document needs to be
 * displayed, exactly like AdminKycReviewModal.tsx does.
 */
export async function getKycFileUrl(storagePath: string): Promise<string> {
  const storageInstance = requireStorage()
  return getDownloadURL(ref(storageInstance, storagePath))
}
