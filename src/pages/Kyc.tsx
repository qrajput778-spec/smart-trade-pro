import { useEffect, useMemo, useRef, useState } from 'react'
import { collection, onSnapshot, query, where } from 'firebase/firestore'
import {
  BookUser,
  Camera,
  CheckCircle2,
  Clock,
  Car,
  IdCard,
  ShieldAlert,
  ShieldCheck,
  ShieldQuestion,
  ShieldX,
} from 'lucide-react'
import Card from '../components/Card'
import Button from '../components/Button'
import Badge from '../components/Badge'
import Modal from '../components/Modal'
import PageContainer from '../components/PageContainer'
import KycDocumentCard from '../components/KycDocumentCard'
import { useAuth } from '../context/AuthContext'
import { db } from '../lib/firebase'
import {
  KYC_DOC_TYPE_LABELS,
  KYC_ID_DOC_ACCEPT,
  KYC_PHOTO_ACCEPT,
  KYC_STATUS_META,
  KycError,
  submitKycVerification,
  validateKycFile,
  type KycDisplayStatus,
} from '../lib/kyc'
import type { KycDocumentInfo, KycDocumentType, KycStatus } from '../types'

interface SubmissionRow {
  id: string
  status: KycStatus
  submittedAt: Date | null
  reviewedAt: Date | null
  rejectionReason: string | null
  idCard: KycDocumentInfo | null
  drivingLicense: KycDocumentInfo | null
  passport: KycDocumentInfo | null
  photo: KycDocumentInfo | null
}

const ID_ACCEPT = KYC_ID_DOC_ACCEPT.join(',')
const PHOTO_ACCEPT = KYC_PHOTO_ACCEPT.join(',')

const STATUS_ICON: Record<KycDisplayStatus, typeof ShieldCheck> = {
  not_started: ShieldQuestion,
  pending: ShieldAlert,
  verified: ShieldCheck,
  rejected: ShieldX,
}

function submittedDocList(row: SubmissionRow): string {
  const types: KycDocumentType[] = []
  if (row.idCard?.uploaded) types.push('idCard')
  if (row.drivingLicense?.uploaded) types.push('drivingLicense')
  if (row.passport?.uploaded) types.push('passport')
  if (row.photo?.uploaded) types.push('photo')
  return types.map((t) => KYC_DOC_TYPE_LABELS[t]).join(', ') || '—'
}

export default function Kyc() {
  const { user } = useAuth()
  const formRef = useRef<HTMLDivElement>(null)

  const [submissions, setSubmissions] = useState<SubmissionRow[]>([])
  const [loading, setLoading] = useState(true)

  const [idCard, setIdCard] = useState<File | null>(null)
  const [drivingLicense, setDrivingLicense] = useState<File | null>(null)
  const [passport, setPassport] = useState<File | null>(null)
  const [photo, setPhoto] = useState<File | null>(null)
  const [photoPreviewUrl, setPhotoPreviewUrl] = useState<string | null>(null)

  const [fieldErrors, setFieldErrors] = useState<Partial<Record<KycDocumentType, string>>>({})
  const [formError, setFormError] = useState<string | null>(null)

  const [confirmOpen, setConfirmOpen] = useState(false)
  const [confirmChecked, setConfirmChecked] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [progress, setProgress] = useState<Partial<Record<KycDocumentType, number>>>({})
  const [successMessage, setSuccessMessage] = useState<string | null>(null)

  useEffect(() => {
    if (!user || !db) {
      setLoading(false)
      return
    }
    // Single equality filter, no orderBy — sorted client-side below, same
    // zero-index pattern as src/lib/balanceRequests.ts.
    const q = query(collection(db, 'kycSubmissions'), where('userId', '==', user.uid))
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const rows = snapshot.docs.map((docSnapshot): SubmissionRow => {
          const data = docSnapshot.data()
          const submittedAt = data.submittedAt
          const reviewedAt = data.reviewedAt
          return {
            id: docSnapshot.id,
            status: data.status === 'verified' || data.status === 'rejected' ? data.status : 'pending',
            submittedAt: submittedAt?.toDate ? submittedAt.toDate() : null,
            reviewedAt: reviewedAt?.toDate ? reviewedAt.toDate() : null,
            rejectionReason: typeof data.rejectionReason === 'string' ? data.rejectionReason : null,
            idCard: data.idCard ?? null,
            drivingLicense: data.drivingLicense ?? null,
            passport: data.passport ?? null,
            photo: data.photo ?? null,
          }
        })
        rows.sort((a, b) => (b.submittedAt?.getTime() ?? 0) - (a.submittedAt?.getTime() ?? 0))
        setSubmissions(rows)
        setLoading(false)
      },
      () => setLoading(false),
    )
    return unsubscribe
  }, [user])

  useEffect(() => {
    if (!photo) {
      setPhotoPreviewUrl(null)
      return
    }
    const url = URL.createObjectURL(photo)
    setPhotoPreviewUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [photo])

  const current = submissions[0] ?? null
  const displayStatus = (current?.status ?? 'not_started') as KycDisplayStatus
  const canSubmit = displayStatus === 'not_started' || displayStatus === 'rejected'
  const StatusIcon = STATUS_ICON[displayStatus]
  const statusMeta = KYC_STATUS_META[displayStatus]

  function handleFileSelect(docType: KycDocumentType, file: File | null) {
    setFormError(null)
    setSuccessMessage(null)
    if (file) {
      const err = validateKycFile(file, docType === 'photo' ? 'photo' : 'id')
      setFieldErrors((prev) => ({ ...prev, [docType]: err ?? undefined }))
      if (err) file = null
    } else {
      setFieldErrors((prev) => ({ ...prev, [docType]: undefined }))
    }
    if (docType === 'idCard') setIdCard(file)
    else if (docType === 'drivingLicense') setDrivingLicense(file)
    else if (docType === 'passport') setPassport(file)
    else setPhoto(file)
  }

  function handleOpenConfirm() {
    setFormError(null)
    if (!idCard && !drivingLicense && !passport) {
      setFormError('Upload at least one government-issued ID: an ID Card, Driving License, or Passport.')
      return
    }
    if (!photo) {
      setFormError('Upload your verification photo.')
      return
    }
    setConfirmChecked(false)
    setConfirmOpen(true)
  }

  async function handleConfirmSubmit() {
    if (!user || !confirmChecked || !photo) return
    setSubmitting(true)
    setFormError(null)
    setProgress({})
    try {
      await submitKycVerification(
        user.uid,
        user.email ?? '',
        { idCard: idCard ?? undefined, drivingLicense: drivingLicense ?? undefined, passport: passport ?? undefined, photo },
        (docType, percent) => setProgress((prev) => ({ ...prev, [docType]: percent })),
      )
      setConfirmOpen(false)
      setIdCard(null)
      setDrivingLicense(null)
      setPassport(null)
      setPhoto(null)
      setProgress({})
      setSuccessMessage('Your documents have been submitted successfully and are awaiting review.')
    } catch (err) {
      setFormError(err instanceof KycError ? err.message : 'Could not submit your verification — please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  const selectedFiles = useMemo(
    () =>
      [
        idCard && { label: 'ID Card', file: idCard },
        drivingLicense && { label: 'Driving License', file: drivingLicense },
        passport && { label: 'Passport', file: passport },
        photo && { label: 'Photo', file: photo },
      ].filter((x): x is { label: string; file: File } => Boolean(x)),
    [idCard, drivingLicense, passport, photo],
  )

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-border border-t-accent-gold" role="status" aria-label="Loading" />
      </div>
    )
  }

  return (
    <PageContainer>
      <header>
        <h1 className="text-2xl font-semibold text-text-primary">KYC Verification</h1>
        <p className="mt-1 text-sm text-text-muted">Complete identity verification to verify your account.</p>
      </header>

      {/* Status card */}
      <Card className="mt-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <span
              className={`flex h-10 w-10 flex-none items-center justify-center rounded-full ${
                statusMeta.tone === 'success'
                  ? 'bg-success/10 text-success'
                  : statusMeta.tone === 'danger'
                    ? 'bg-danger/10 text-danger'
                    : statusMeta.tone === 'gold'
                      ? 'bg-accent-gold-soft text-accent-gold'
                      : 'bg-surface-alt text-text-muted'
              }`}
            >
              <StatusIcon size={20} />
            </span>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-semibold text-text-primary">Verification Status</h2>
                <Badge tone={statusMeta.tone}>{statusMeta.label}</Badge>
              </div>

              {displayStatus === 'not_started' && (
                <p className="mt-1 max-w-md text-sm text-text-muted">
                  You haven't submitted your identity verification yet. It only takes a couple of minutes.
                </p>
              )}
              {displayStatus === 'pending' && current && (
                <>
                  <p className="mt-1 max-w-md text-sm text-text-muted">
                    Your documents have been submitted and are awaiting admin review.
                  </p>
                  {current.submittedAt && (
                    <p className="mt-1 text-xs text-text-muted">
                      Submitted {current.submittedAt.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}
                    </p>
                  )}
                </>
              )}
              {displayStatus === 'verified' && current && (
                <>
                  <p className="mt-1 max-w-md text-sm text-text-muted">Your identity has been successfully verified.</p>
                  {current.reviewedAt && (
                    <p className="mt-1 text-xs text-text-muted">
                      Verified {current.reviewedAt.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}
                    </p>
                  )}
                </>
              )}
              {displayStatus === 'rejected' && current && (
                <>
                  <p className="mt-1 max-w-md text-sm text-text-muted">
                    Your verification was rejected. Review the reason below and resubmit your documents.
                  </p>
                  {current.rejectionReason && (
                    <p className="mt-2 rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
                      <strong className="font-semibold">Reason: </strong>
                      {current.rejectionReason}
                    </p>
                  )}
                </>
              )}
            </div>
          </div>

          {displayStatus === 'not_started' && (
            <Button type="button" onClick={() => formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>
              Start Verification
            </Button>
          )}
          {displayStatus === 'rejected' && (
            <Button type="button" onClick={() => formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>
              Resubmit Documents
            </Button>
          )}
        </div>
      </Card>

      {successMessage && (
        <p className="mt-4 flex items-center gap-2 rounded-md border border-success/30 bg-success/10 px-4 py-3 text-sm text-success">
          <CheckCircle2 size={16} className="flex-none" /> {successMessage}
        </p>
      )}

      {/* Upload form — hidden entirely once a submission is pending or verified. */}
      {canSubmit && (
        <section ref={formRef} className="mt-10">
          <h2 className="text-lg font-semibold text-text-primary">Upload Documents</h2>
          <p className="mt-1 text-xs text-text-muted">
            Required: your verification photo, plus <strong className="font-medium text-text-primary">one</strong> government-issued
            ID below (ID Card, Driving License, or Passport — you don't need all three). This is a simulated verification for a
            course project — please use placeholder images, never a real government ID document.
          </p>

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <KycDocumentCard
              title="ID Card"
              description="A national or state-issued ID card."
              icon={IdCard}
              accept={ID_ACCEPT}
              file={idCard}
              onFileSelect={(f) => handleFileSelect('idCard', f)}
              error={fieldErrors.idCard ?? null}
              progress={progress.idCard ?? null}
              badge="Choose one ID"
            />
            <KycDocumentCard
              title="Driving License"
              description="A valid driving license."
              icon={Car}
              accept={ID_ACCEPT}
              file={drivingLicense}
              onFileSelect={(f) => handleFileSelect('drivingLicense', f)}
              error={fieldErrors.drivingLicense ?? null}
              progress={progress.drivingLicense ?? null}
              badge="Choose one ID"
            />
            <KycDocumentCard
              title="Passport"
              description="A valid passport photo page."
              icon={BookUser}
              accept={ID_ACCEPT}
              file={passport}
              onFileSelect={(f) => handleFileSelect('passport', f)}
              error={fieldErrors.passport ?? null}
              progress={progress.passport ?? null}
              badge="Choose one ID"
            />
            <KycDocumentCard
              title="Upload Photo"
              description="A clear photo of yourself for verification (not facial recognition)."
              icon={Camera}
              accept={PHOTO_ACCEPT}
              file={photo}
              onFileSelect={(f) => handleFileSelect('photo', f)}
              error={fieldErrors.photo ?? null}
              progress={progress.photo ?? null}
              previewUrl={photoPreviewUrl}
              badge="Required"
            />
          </div>

          {formError && <p className="mt-4 text-sm text-danger">{formError}</p>}

          <div className="mt-5">
            <Button type="button" onClick={handleOpenConfirm}>
              Submit for Verification
            </Button>
          </div>
        </section>
      )}

      {/* History */}
      <section className="mt-10">
        <h2 className="text-lg font-semibold text-text-primary">Verification History</h2>
        {submissions.length === 0 ? (
          <Card className="mt-4 py-10 text-center text-sm text-text-muted">No verification submissions yet.</Card>
        ) : (
          <Card className="mt-4 overflow-x-auto p-0">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-text-muted">
                  <th className="px-4 py-3 font-medium">Submitted</th>
                  <th className="px-4 py-3 font-medium">Documents</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Reviewed</th>
                  <th className="px-4 py-3 font-medium">Reason</th>
                </tr>
              </thead>
              <tbody>
                {submissions.map((row) => (
                  <tr key={row.id} className="border-b border-border last:border-0">
                    <td className="px-4 py-3 text-text-muted">
                      {row.submittedAt ? row.submittedAt.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }) : '—'}
                    </td>
                    <td className="px-4 py-3 text-text-primary">{submittedDocList(row)}</td>
                    <td className="px-4 py-3">
                      <Badge tone={KYC_STATUS_META[row.status].tone}>{KYC_STATUS_META[row.status].label}</Badge>
                    </td>
                    <td className="px-4 py-3 text-text-muted">
                      {row.reviewedAt ? row.reviewedAt.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }) : '—'}
                    </td>
                    <td className="max-w-xs px-4 py-3 text-text-muted">{row.rejectionReason ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}
      </section>

      {/* Confirm-before-submit modal */}
      <Modal open={confirmOpen} onClose={() => !submitting && setConfirmOpen(false)} title="Confirm Submission">
        <div className="space-y-4">
          <p className="text-sm text-text-muted">Review what you're about to submit:</p>
          <ul className="space-y-1.5">
            {selectedFiles.map(({ label, file }) => (
              <li key={label} className="flex items-center justify-between rounded-md border border-border bg-surface-alt px-3 py-2 text-sm">
                <span className="text-text-muted">{label}</span>
                <span className="truncate pl-3 font-medium text-text-primary">{file.name}</span>
              </li>
            ))}
          </ul>

          <p className="flex items-start gap-2 rounded-md border border-border bg-surface-alt px-3 py-2.5 text-xs text-text-muted">
            <Clock size={14} className="mt-0.5 flex-none text-accent-gold" />
            This is a simulated verification for a course project. An admin will review these files — your status will show
            "Verification Pending" until then.
          </p>

          <label className="flex items-start gap-2 text-sm text-text-primary">
            <input
              type="checkbox"
              checked={confirmChecked}
              onChange={(event) => setConfirmChecked(event.target.checked)}
              className="mt-0.5 h-4 w-4 flex-none accent-accent-gold"
            />
            I confirm that the submitted information is accurate.
          </label>

          {formError && <p className="text-xs text-danger">{formError}</p>}

          <div className="flex gap-3">
            <Button type="button" variant="secondary" onClick={() => setConfirmOpen(false)} disabled={submitting}>
              Cancel
            </Button>
            <Button type="button" className="flex-1" onClick={handleConfirmSubmit} disabled={!confirmChecked || submitting}>
              {submitting ? 'Submitting…' : 'Confirm & Submit'}
            </Button>
          </div>
        </div>
      </Modal>
    </PageContainer>
  )
}
