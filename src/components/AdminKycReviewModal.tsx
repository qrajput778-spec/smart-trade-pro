import { useEffect, useState } from 'react'
import { ExternalLink, FileText } from 'lucide-react'
import Modal from './Modal'
import Card from './Card'
import Button from './Button'
import TextField from './TextField'
import Badge from './Badge'
import { useAuth } from '../context/AuthContext'
import {
  KYC_DOC_TYPE_LABELS,
  KYC_STATUS_META,
  KycError,
  approveKycSubmission,
  getKycFileUrl,
  rejectKycSubmission,
} from '../lib/kyc'
import type { KycDocumentInfo, KycDocumentType, KycStatus } from '../types'

interface SubmissionForReview {
  id: string
  userId: string
  userEmail: string
  status: KycStatus
  submittedAt: Date | null
  reviewedAt: Date | null
  reviewedBy: string | null
  rejectionReason: string | null
  idCard: KycDocumentInfo | null
  drivingLicense: KycDocumentInfo | null
  passport: KycDocumentInfo | null
  photo: KycDocumentInfo | null
}

interface AdminKycReviewModalProps {
  submission: SubmissionForReview
  userDisplayName: string
  /** This same user's other submissions, for review-history context. */
  history: SubmissionForReview[]
  onClose: () => void
}

const DOC_ORDER: KycDocumentType[] = ['idCard', 'drivingLicense', 'passport', 'photo']

function isPdf(fileName: string) {
  return fileName.toLowerCase().endsWith('.pdf')
}

export default function AdminKycReviewModal({ submission, userDisplayName, history, onClose }: AdminKycReviewModalProps) {
  const { user: adminUser } = useAuth()

  const [fileUrls, setFileUrls] = useState<Partial<Record<KycDocumentType, string>>>({})
  const [fileErrors, setFileErrors] = useState<Partial<Record<KycDocumentType, string>>>({})
  const [processing, setProcessing] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [rejecting, setRejecting] = useState(false)
  const [rejectReason, setRejectReason] = useState('')

  const docs: { type: KycDocumentType; info: KycDocumentInfo | null }[] = DOC_ORDER.map((type) => ({
    type,
    info: submission[type],
  }))

  useEffect(() => {
    let cancelled = false
    setFileUrls({})
    setFileErrors({})
    for (const { type, info } of docs) {
      if (!info?.uploaded || !info.storagePath) continue
      getKycFileUrl(info.storagePath)
        .then((url) => {
          if (!cancelled) setFileUrls((prev) => ({ ...prev, [type]: url }))
        })
        .catch(() => {
          if (!cancelled) setFileErrors((prev) => ({ ...prev, [type]: 'Could not load this file.' }))
        })
    }
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [submission.id])

  async function handleApprove() {
    if (!adminUser) return
    if (
      !window.confirm(
        `Approve identity verification for ${submission.userEmail}? This marks their account as Verified.`,
      )
    ) {
      return
    }
    setProcessing(true)
    setActionError(null)
    try {
      await approveKycSubmission(adminUser.uid, submission.id)
      onClose()
    } catch (err) {
      setActionError(err instanceof KycError ? err.message : 'Could not approve this submission — please try again.')
    } finally {
      setProcessing(false)
    }
  }

  async function handleConfirmReject() {
    if (!adminUser) return
    setProcessing(true)
    setActionError(null)
    try {
      await rejectKycSubmission(adminUser.uid, submission.id, rejectReason)
      onClose()
    } catch (err) {
      setActionError(err instanceof KycError ? err.message : 'Could not reject this submission — please try again.')
    } finally {
      setProcessing(false)
    }
  }

  return (
    <Modal open onClose={onClose} title="Review KYC Submission" widthClassName="max-w-2xl">
      <div className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-surface-alt px-3 py-2.5">
          <div>
            <p className="text-sm font-medium text-text-primary">{userDisplayName}</p>
            <p className="text-xs text-text-muted">
              {submission.userEmail} · {submission.userId}
            </p>
          </div>
          <div className="text-right">
            <Badge tone={KYC_STATUS_META[submission.status].tone}>{KYC_STATUS_META[submission.status].label}</Badge>
            <p className="mt-1 text-xs text-text-muted">
              Submitted{' '}
              {submission.submittedAt
                ? submission.submittedAt.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })
                : '—'}
            </p>
          </div>
        </div>

        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-text-muted">Submitted documents</p>
          <div className="mt-2 grid gap-3 sm:grid-cols-2">
            {docs
              .filter((d) => d.info?.uploaded)
              .map(({ type, info }) => {
                const url = fileUrls[type]
                const err = fileErrors[type]
                const pdf = info ? isPdf(info.fileName) : false
                return (
                  <Card key={type} className="p-3">
                    <p className="text-xs font-medium text-text-primary">{KYC_DOC_TYPE_LABELS[type]}</p>
                    <p className="truncate text-[11px] text-text-muted">{info?.fileName}</p>
                    <div className="mt-2">
                      {err ? (
                        <p className="text-xs text-danger">{err}</p>
                      ) : !url ? (
                        <div className="flex h-24 items-center justify-center rounded bg-surface text-xs text-text-muted">
                          Loading…
                        </div>
                      ) : pdf ? (
                        <a
                          href={url}
                          target="_blank"
                          rel="noreferrer"
                          className="flex items-center gap-1.5 text-xs font-medium text-accent-gold hover:underline"
                        >
                          <FileText size={14} /> Open PDF <ExternalLink size={12} />
                        </a>
                      ) : (
                        <a href={url} target="_blank" rel="noreferrer">
                          <img src={url} alt={KYC_DOC_TYPE_LABELS[type]} className="h-32 w-full rounded object-cover" />
                        </a>
                      )}
                    </div>
                  </Card>
                )
              })}
          </div>
        </div>

        {history.length > 0 && (
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-text-muted">Previous submissions</p>
            <ul className="mt-2 space-y-1.5">
              {history.map((h) => (
                <li key={h.id} className="flex items-center justify-between rounded-md border border-border bg-surface-alt px-3 py-2 text-xs">
                  <span className="text-text-muted">
                    {h.submittedAt ? h.submittedAt.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : '—'}
                  </span>
                  <Badge tone={KYC_STATUS_META[h.status].tone}>{KYC_STATUS_META[h.status].label}</Badge>
                </li>
              ))}
            </ul>
          </div>
        )}

        {actionError && <p className="text-xs text-danger">{actionError}</p>}

        {submission.status === 'pending' ? (
          rejecting ? (
            <div className="space-y-3 rounded-md border border-danger/30 bg-danger/5 p-3">
              <TextField
                label="Rejection reason (required)"
                name="rejectReason"
                value={rejectReason}
                onChange={(event) => setRejectReason(event.target.value)}
                placeholder="e.g. Document image was unclear"
              />
              <div className="flex gap-3">
                <Button variant="ghost" onClick={() => setRejecting(false)} disabled={processing}>
                  Cancel
                </Button>
                <Button variant="danger" className="flex-1" onClick={handleConfirmReject} disabled={processing || !rejectReason.trim()}>
                  {processing ? 'Rejecting…' : 'Confirm Rejection'}
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex gap-3">
              <Button variant="danger" onClick={() => setRejecting(true)} disabled={processing}>
                Reject
              </Button>
              <Button className="flex-1" onClick={handleApprove} disabled={processing}>
                {processing ? 'Approving…' : 'Approve / Verify'}
              </Button>
            </div>
          )
        ) : (
          <div className="rounded-md border border-border bg-surface-alt px-3 py-2.5 text-xs text-text-muted">
            Already reviewed {submission.reviewedAt ? submission.reviewedAt.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }) : ''}
            {submission.reviewedBy ? ` by ${submission.reviewedBy.slice(0, 8)}…` : ''}.
            {submission.status === 'rejected' && submission.rejectionReason && (
              <>
                {' '}
                Reason: {submission.rejectionReason}
              </>
            )}
          </div>
        )}
      </div>
    </Modal>
  )
}
