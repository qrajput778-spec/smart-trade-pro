import { Fragment, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { collection, onSnapshot } from 'firebase/firestore'
import { Check, Search, X } from 'lucide-react'
import Card from './Card'
import Button from './Button'
import TextField from './TextField'
import Badge from './Badge'
import { useAuth } from '../context/AuthContext'
import { db } from '../lib/firebase'
import { formatUsd } from '../lib/constants'
import {
  BalanceRequestError,
  approveDepositRequest,
  approveWithdrawalRequest,
  rejectDepositRequest,
  rejectWithdrawalRequest,
} from '../lib/balanceRequests'
import type { BalanceRequestStatus, BalanceRequestType } from '../types'

interface RequestRow {
  id: string
  type: string
  userId: string
  userEmail: string
  amount: number
  status: BalanceRequestStatus
  createdAt: Date | null
  reviewedAt: Date | null
  reviewedBy: string | null
  adminNote: string | null
  /** Withdrawal-only, informational — see WithdrawModal.tsx / balanceRequests.ts. */
  recipientAddress: string | null
}

type StatusFilter = 'all' | BalanceRequestStatus

const STATUS_TONE: Record<BalanceRequestStatus, 'gold' | 'success' | 'danger'> = {
  pending: 'gold',
  approved: 'success',
  rejected: 'danger',
}

const STATUS_FILTERS: StatusFilter[] = ['all', 'pending', 'approved', 'rejected']

/**
 * Shared admin review table for both /admin/deposits and /admin/withdrawals
 * — same layout, filters, search, and approve/reject flow either way, just
 * parameterized by which request `type` it manages and which
 * approve/reject functions (src/lib/balanceRequests.ts) it calls.
 */
export default function BalanceRequestsAdminTable({ type }: { type: BalanceRequestType }) {
  const { user: adminUser } = useAuth()

  const [rows, setRows] = useState<RequestRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [statusFilter, setStatusFilter] = useState<StatusFilter>('pending')
  const [search, setSearch] = useState('')

  const [processingId, setProcessingId] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [rejectingId, setRejectingId] = useState<string | null>(null)
  const [rejectNote, setRejectNote] = useState('')

  useEffect(() => {
    if (!db) {
      setError('Firebase is not configured yet — add your project keys to .env.')
      setLoading(false)
      return
    }

    // Fetches the whole collection with no where/orderBy at all — filtered
    // and sorted entirely client-side below (same client-side-search
    // pattern AdminUsers.tsx already uses). Deliberate: it needs zero
    // Firestore indexes (a where+orderBy combo would need a manually
    // deployed composite index), and the collection is small enough for a
    // course project that reading all of it costs nothing meaningful.
    const unsubscribe = onSnapshot(
      collection(db, 'balanceRequests'),
      (snapshot) => {
        const allRows = snapshot.docs.map((docSnapshot): RequestRow => {
          const data = docSnapshot.data()
          const createdAt = data.createdAt
          const reviewedAt = data.reviewedAt
          return {
            id: docSnapshot.id,
            type: String(data.type ?? ''),
            userId: String(data.userId ?? ''),
            userEmail: typeof data.userEmail === 'string' ? data.userEmail : '—',
            amount: typeof data.amount === 'number' ? data.amount : 0,
            status: data.status === 'approved' || data.status === 'rejected' ? data.status : 'pending',
            createdAt: createdAt?.toDate ? createdAt.toDate() : null,
            reviewedAt: reviewedAt?.toDate ? reviewedAt.toDate() : null,
            reviewedBy: typeof data.reviewedBy === 'string' ? data.reviewedBy : null,
            adminNote: typeof data.adminNote === 'string' ? data.adminNote : null,
            recipientAddress: typeof data.recipientAddress === 'string' ? data.recipientAddress : null,
          }
        })
        const filtered = allRows.filter((row) => row.type === type)
        filtered.sort((a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0))
        setRows(filtered)
        setError(null)
        setLoading(false)
      },
      (err) => {
        // eslint-disable-next-line no-console
        console.error(`[admin] failed to load ${type} requests`, err)
        setError('Could not load requests. The admin Firestore rules may not be deployed yet.')
        setLoading(false)
      },
    )

    return unsubscribe
  }, [type])

  const normalizedSearch = search.trim().toLowerCase()
  const visibleRows = rows.filter((row) => {
    if (statusFilter !== 'all' && row.status !== statusFilter) return false
    if (!normalizedSearch) return true
    return row.userEmail.toLowerCase().includes(normalizedSearch) || row.userId.toLowerCase().includes(normalizedSearch)
  })

  async function handleApprove(row: RequestRow) {
    if (!adminUser) return
    const label = type === 'deposit' ? 'deposit' : 'withdrawal'
    const verb = type === 'deposit' ? 'increase' : 'decrease'
    if (
      !window.confirm(
        `Approve this ${formatUsd(row.amount)} ${label} for ${row.userEmail}? This will ${verb} their ` +
          "virtual balance by that amount and can't be undone from here.",
      )
    ) {
      return
    }

    setProcessingId(row.id)
    setActionError(null)
    try {
      if (type === 'deposit') {
        await approveDepositRequest(adminUser.uid, row.id)
      } else {
        await approveWithdrawalRequest(adminUser.uid, row.id)
      }
    } catch (err) {
      setActionError(
        err instanceof BalanceRequestError ? err.message : 'Could not approve this request — please try again.',
      )
    } finally {
      setProcessingId(null)
    }
  }

  function startReject(row: RequestRow) {
    setRejectingId(row.id)
    setRejectNote('')
    setActionError(null)
  }

  async function confirmReject(row: RequestRow) {
    if (!adminUser) return

    setProcessingId(row.id)
    setActionError(null)
    try {
      if (type === 'deposit') {
        await rejectDepositRequest(adminUser.uid, row.id, rejectNote)
      } else {
        await rejectWithdrawalRequest(adminUser.uid, row.id, rejectNote)
      }
      setRejectingId(null)
      setRejectNote('')
    } catch (err) {
      setActionError(
        err instanceof BalanceRequestError ? err.message : 'Could not reject this request — please try again.',
      )
    } finally {
      setProcessingId(null)
    }
  }

  const title = type === 'deposit' ? 'deposit requests' : 'withdrawal requests'

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 rounded-md border border-border bg-surface-alt px-3 py-2 text-sm text-text-muted focus-within:border-accent-gold sm:max-w-sm">
          <Search size={16} className="flex-none" />
          <input
            type="text"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search by email or UID…"
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
      {actionError && (
        <Card className="mt-4 border-danger/40">
          <p className="text-sm text-danger">{actionError}</p>
        </Card>
      )}

      <Card className="mt-4 overflow-x-auto p-0">
        <table className="w-full min-w-[760px] text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-text-muted">
              <th className="px-4 py-3 font-medium">User</th>
              <th className="px-4 py-3 font-medium">Amount</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Requested</th>
              <th className="px-4 py-3 font-medium">Reviewed</th>
              <th className="px-4 py-3 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-text-muted">
                  Loading {title}…
                </td>
              </tr>
            ) : visibleRows.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-text-muted">
                  No {title} match the current filters.
                </td>
              </tr>
            ) : (
              visibleRows.map((row) => (
                <Fragment key={row.id}>
                  <tr className="border-b border-border last:border-0">
                    <td className="px-4 py-3">
                      <Link to={`/admin/users/${row.userId}`} className="text-text-primary hover:text-accent-gold hover:underline">
                        {row.userEmail}
                      </Link>
                      {type === 'withdrawal' && row.recipientAddress && (
                        <p className="mt-0.5 max-w-[220px] truncate font-mono text-[11px] text-text-muted" title={row.recipientAddress}>
                          to: {row.recipientAddress}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3 font-mono text-text-primary">{formatUsd(row.amount)}</td>
                    <td className="px-4 py-3">
                      <Badge tone={STATUS_TONE[row.status]} className="capitalize">
                        {row.status}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-text-muted">
                      {row.createdAt
                        ? row.createdAt.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })
                        : '—'}
                    </td>
                    <td className="px-4 py-3 text-text-muted">
                      {row.reviewedAt
                        ? row.reviewedAt.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })
                        : '—'}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {row.status === 'pending' ? (
                        <div className="flex justify-end gap-2">
                          <Button
                            variant="secondary"
                            className="flex items-center gap-1 px-2.5 py-1.5 text-xs"
                            disabled={processingId === row.id}
                            onClick={() => handleApprove(row)}
                          >
                            <Check size={14} /> Approve
                          </Button>
                          <Button
                            variant="danger"
                            className="flex items-center gap-1 px-2.5 py-1.5 text-xs"
                            disabled={processingId === row.id}
                            onClick={() => (rejectingId === row.id ? setRejectingId(null) : startReject(row))}
                          >
                            <X size={14} /> Reject
                          </Button>
                        </div>
                      ) : (
                        <span className="text-xs text-text-muted">
                          {row.reviewedBy ? `by ${row.reviewedBy.slice(0, 8)}…` : '—'}
                        </span>
                      )}
                    </td>
                  </tr>
                  {rejectingId === row.id && (
                    <tr className="border-b border-border bg-surface-alt/50 last:border-0">
                      <td colSpan={6} className="px-4 py-3">
                        <div className="flex flex-wrap items-end gap-3">
                          <div className="min-w-[240px] flex-1">
                            <TextField
                              label="Rejection reason (optional)"
                              name={`reject-note-${row.id}`}
                              value={rejectNote}
                              onChange={(event) => setRejectNote(event.target.value)}
                              placeholder="e.g. Amount doesn't match what was requested"
                            />
                          </div>
                          <Button variant="danger" disabled={processingId === row.id} onClick={() => confirmReject(row)}>
                            {processingId === row.id ? 'Rejecting…' : 'Confirm Rejection'}
                          </Button>
                          <Button variant="ghost" onClick={() => setRejectingId(null)}>
                            Cancel
                          </Button>
                        </div>
                        {row.adminNote && <p className="mt-2 text-xs text-text-muted">Previous note: {row.adminNote}</p>}
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))
            )}
          </tbody>
        </table>
      </Card>
    </div>
  )
}
