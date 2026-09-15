import { useEffect, useState } from 'react'
import { collection, getDocs, onSnapshot } from 'firebase/firestore'
import { Search, ShieldCheck } from 'lucide-react'
import Card from '../../components/Card'
import Badge from '../../components/Badge'
import PageContainer from '../../components/PageContainer'
import AdminKycReviewModal from '../../components/AdminKycReviewModal'
import { db } from '../../lib/firebase'
import { KYC_DOC_TYPE_LABELS, KYC_STATUS_META } from '../../lib/kyc'
import type { KycDocumentInfo, KycDocumentType, KycStatus } from '../../types'

interface SubmissionRow {
  id: string
  userId: string
  userEmail: string
  status: KycStatus
  submittedAt: Date | null
  reviewedAt: Date | null
  reviewedBy: string | null
  rejectionReason: string | null
  idCardFront: KycDocumentInfo | null
  idCardBack: KycDocumentInfo | null
  drivingLicenseFront: KycDocumentInfo | null
  drivingLicenseBack: KycDocumentInfo | null
}

interface UserInfo {
  displayName: string
}

type StatusFilter = 'all' | KycStatus

const STATUS_FILTERS: StatusFilter[] = ['all', 'pending', 'verified', 'rejected']

const DOC_TYPES: KycDocumentType[] = ['idCardFront', 'idCardBack', 'drivingLicenseFront', 'drivingLicenseBack']

function docTypesFor(row: SubmissionRow): string {
  const types = DOC_TYPES.filter((t) => row[t]?.uploaded)
  return types.map((t) => KYC_DOC_TYPE_LABELS[t]).join(', ') || '—'
}

export default function AdminKyc() {
  const [rows, setRows] = useState<SubmissionRow[]>([])
  const [userInfo, setUserInfo] = useState<Record<string, UserInfo>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [statusFilter, setStatusFilter] = useState<StatusFilter>('pending')
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)

  // One-time lookup so the table can show a display name and support
  // name-based search — same join pattern AdminTrades/AdminSupport use.
  useEffect(() => {
    if (!db) return
    getDocs(collection(db, 'users'))
      .then((snapshot) => {
        const map: Record<string, UserInfo> = {}
        snapshot.forEach((docSnapshot) => {
          const data = docSnapshot.data()
          map[docSnapshot.id] = { displayName: typeof data.displayName === 'string' ? data.displayName : docSnapshot.id }
        })
        setUserInfo(map)
      })
      .catch(() => {
        // Non-fatal — the table still works, just shows uids instead of names.
      })
  }, [])

  useEffect(() => {
    if (!db) {
      setError('Firebase is not configured yet — add your project keys to .env.')
      setLoading(false)
      return
    }

    // Fetches the whole collection with no where/orderBy — filtered and
    // sorted client-side below, same deliberate zero-index pattern as
    // BalanceRequestsAdminTable.tsx.
    const unsubscribe = onSnapshot(
      collection(db, 'kycSubmissions'),
      (snapshot) => {
        const allRows = snapshot.docs.map((docSnapshot): SubmissionRow => {
          const data = docSnapshot.data()
          const submittedAt = data.submittedAt
          const reviewedAt = data.reviewedAt
          return {
            id: docSnapshot.id,
            userId: String(data.userId ?? ''),
            userEmail: typeof data.userEmail === 'string' ? data.userEmail : '—',
            status: data.status === 'verified' || data.status === 'rejected' ? data.status : 'pending',
            submittedAt: submittedAt?.toDate ? submittedAt.toDate() : null,
            reviewedAt: reviewedAt?.toDate ? reviewedAt.toDate() : null,
            reviewedBy: typeof data.reviewedBy === 'string' ? data.reviewedBy : null,
            rejectionReason: typeof data.rejectionReason === 'string' ? data.rejectionReason : null,
            idCardFront: data.idCardFront ?? null,
            idCardBack: data.idCardBack ?? null,
            drivingLicenseFront: data.drivingLicenseFront ?? null,
            drivingLicenseBack: data.drivingLicenseBack ?? null,
          }
        })
        allRows.sort((a, b) => (b.submittedAt?.getTime() ?? 0) - (a.submittedAt?.getTime() ?? 0))
        setRows(allRows)
        setError(null)
        setLoading(false)
      },
      (err) => {
        // eslint-disable-next-line no-console
        console.error('[admin] failed to load KYC submissions', err)
        setError('Could not load KYC submissions. The admin Firestore rules may not be deployed yet.')
        setLoading(false)
      },
    )

    return unsubscribe
  }, [])

  const normalizedSearch = search.trim().toLowerCase()
  const visibleRows = rows.filter((row) => {
    if (statusFilter !== 'all' && row.status !== statusFilter) return false
    if (!normalizedSearch) return true
    const name = userInfo[row.userId]?.displayName?.toLowerCase() ?? ''
    return (
      row.userEmail.toLowerCase().includes(normalizedSearch) ||
      row.userId.toLowerCase().includes(normalizedSearch) ||
      name.includes(normalizedSearch)
    )
  })

  const selectedRow = rows.find((row) => row.id === selectedId) ?? null

  return (
    <PageContainer>
      <header className="flex items-center gap-2">
        <ShieldCheck size={22} className="text-accent-gold" />
        <div>
          <h1 className="text-2xl font-semibold text-text-primary">KYC Verification</h1>
          <p className="mt-1 text-sm text-text-muted">
            Review submitted identity documents and approve or reject verification requests.
          </p>
        </div>
      </header>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 rounded-md border border-border bg-surface-alt px-3 py-2 text-sm text-text-muted focus-within:border-accent-gold sm:max-w-sm">
          <Search size={16} className="flex-none" />
          <input
            type="text"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search by name, email, or UID…"
            className="w-full bg-transparent text-text-primary placeholder:text-text-muted focus:outline-none"
          />
        </div>

        <div className="flex flex-wrap gap-1.5">
          {STATUS_FILTERS.map((filter) => (
            <button
              key={filter}
              type="button"
              onClick={() => setStatusFilter(filter)}
              className={`rounded-full px-3 py-1 text-xs font-medium capitalize transition-colors ${
                statusFilter === filter
                  ? 'bg-accent-gold-soft text-accent-gold'
                  : 'bg-surface-alt text-text-muted hover:text-text-primary'
              }`}
            >
              {filter}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <Card className="mt-4 border-danger/40">
          <p className="text-sm text-danger">{error}</p>
        </Card>
      )}

      <Card className="mt-4 overflow-x-auto p-0">
        <table className="w-full min-w-[900px] text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-text-muted">
              <th className="px-4 py-3 font-medium">User</th>
              <th className="px-4 py-3 font-medium">Email</th>
              <th className="px-4 py-3 font-medium">Submitted</th>
              <th className="px-4 py-3 font-medium">Documents</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Reviewed</th>
              <th className="px-4 py-3 font-medium">Reviewer</th>
              <th className="px-4 py-3 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-text-muted">
                  Loading submissions…
                </td>
              </tr>
            ) : visibleRows.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-text-muted">
                  No KYC submissions match the current filters.
                </td>
              </tr>
            ) : (
              visibleRows.map((row) => (
                <tr key={row.id} className="border-b border-border last:border-0">
                  <td className="px-4 py-3 font-medium text-text-primary">{userInfo[row.userId]?.displayName ?? row.userId}</td>
                  <td className="px-4 py-3 text-text-muted">{row.userEmail}</td>
                  <td className="px-4 py-3 text-text-muted">
                    {row.submittedAt ? row.submittedAt.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }) : '—'}
                  </td>
                  <td className="px-4 py-3 text-text-muted">{docTypesFor(row)}</td>
                  <td className="px-4 py-3">
                    <Badge tone={KYC_STATUS_META[row.status].tone}>{KYC_STATUS_META[row.status].label}</Badge>
                  </td>
                  <td className="px-4 py-3 text-text-muted">
                    {row.reviewedAt ? row.reviewedAt.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }) : '—'}
                  </td>
                  <td className="px-4 py-3 text-text-muted">{row.reviewedBy ? `${row.reviewedBy.slice(0, 8)}…` : '—'}</td>
                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      onClick={() => setSelectedId(row.id)}
                      className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-text-primary transition-colors hover:border-accent-gold hover:text-accent-gold"
                    >
                      Review
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </Card>

      {selectedRow && (
        <AdminKycReviewModal
          submission={selectedRow}
          userDisplayName={userInfo[selectedRow.userId]?.displayName ?? selectedRow.userId}
          history={rows.filter((row) => row.userId === selectedRow.userId && row.id !== selectedRow.id)}
          onClose={() => setSelectedId(null)}
        />
      )}
    </PageContainer>
  )
}
