import { useEffect, useState } from 'react'
import { collection, onSnapshot, query, where } from 'firebase/firestore'
import { ArrowDownToLine, ArrowUpFromLine } from 'lucide-react'
import Card from './Card'
import Badge from './Badge'
import { db } from '../lib/firebase'
import { formatUsd } from '../lib/constants'
import type { BalanceRequestStatus, BalanceRequestType } from '../types'

interface BalanceRequestPanelProps {
  uid: string
}

interface RequestRow {
  id: string
  type: BalanceRequestType
  amount: number
  status: BalanceRequestStatus
  createdAt: Date | null
  reviewedAt: Date | null
  adminNote: string | null
}

const STATUS_TONE: Record<BalanceRequestStatus, 'gold' | 'success' | 'danger'> = {
  pending: 'gold',
  approved: 'success',
  rejected: 'danger',
}

/**
 * Read-only deposit/withdrawal request history for the Wallet page.
 * Submitting requests happens through DepositModal/WithdrawModal (launched
 * from the wallet balance card) — this component only ever displays what's
 * already in Firestore, so there's exactly one place a request gets
 * created, not two competing ones.
 */
export default function BalanceRequestPanel({ uid }: BalanceRequestPanelProps) {
  const [requests, setRequests] = useState<RequestRow[]>([])
  const [requestsLoading, setRequestsLoading] = useState(true)

  useEffect(() => {
    if (!db) {
      setRequestsLoading(false)
      return
    }
    // Single equality filter, no orderBy — sorted client-side below. This
    // needs zero Firestore indexes: a query with one "==" filter and no
    // additional orderBy on a different field is always covered by
    // Firestore's automatic single-field indexing.
    const requestsQuery = query(collection(db, 'balanceRequests'), where('userId', '==', uid))
    const unsubscribe = onSnapshot(
      requestsQuery,
      (snapshot) => {
        const rows = snapshot.docs.map((docSnapshot): RequestRow => {
          const data = docSnapshot.data()
          const createdAt = data.createdAt
          const reviewedAt = data.reviewedAt
          return {
            id: docSnapshot.id,
            type: data.type === 'withdrawal' ? 'withdrawal' : 'deposit',
            amount: typeof data.amount === 'number' ? data.amount : 0,
            status: data.status === 'approved' || data.status === 'rejected' ? data.status : 'pending',
            createdAt: createdAt?.toDate ? createdAt.toDate() : null,
            reviewedAt: reviewedAt?.toDate ? reviewedAt.toDate() : null,
            adminNote: typeof data.adminNote === 'string' ? data.adminNote : null,
          }
        })
        rows.sort((a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0))
        setRequests(rows)
        setRequestsLoading(false)
      },
      () => setRequestsLoading(false),
    )
    return unsubscribe
  }, [uid])

  return (
    <section className="mt-10">
      <h2 className="text-lg font-semibold text-text-primary">Deposit &amp; Withdrawal History</h2>
      <p className="mt-1 text-xs text-text-muted">
        Every request you submit is reviewed by an admin before your balance changes — nothing here
        is a real payment, bank transfer, or card charge.
      </p>

      {requestsLoading ? (
        <Card className="mt-4 animate-pulse py-10 text-center text-sm text-text-muted">Loading…</Card>
      ) : requests.length === 0 ? (
        <Card className="mt-4 py-10 text-center text-sm text-text-muted">
          No deposit or withdrawal requests yet — use the Deposit or Withdraw button above to submit one.
        </Card>
      ) : (
        <Card className="mt-4 overflow-x-auto p-0">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-text-muted">
                <th className="px-4 py-3 font-medium">Type</th>
                <th className="px-4 py-3 font-medium">Amount</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Submitted</th>
                <th className="px-4 py-3 font-medium">Reviewed</th>
              </tr>
            </thead>
            <tbody>
              {requests.map((request) => {
                const Icon = request.type === 'deposit' ? ArrowDownToLine : ArrowUpFromLine
                return (
                  <tr key={request.id} className="border-b border-border last:border-0">
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center gap-1.5 font-mono text-xs font-semibold uppercase ${
                          request.type === 'deposit' ? 'text-success' : 'text-danger'
                        }`}
                      >
                        <Icon size={14} /> {request.type}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-mono text-text-primary">{formatUsd(request.amount)}</td>
                    <td className="px-4 py-3">
                      <Badge tone={STATUS_TONE[request.status]} className="capitalize">
                        {request.status}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-text-muted">
                      {request.createdAt
                        ? request.createdAt.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })
                        : '—'}
                    </td>
                    <td className="px-4 py-3 text-text-muted">
                      {request.reviewedAt
                        ? request.reviewedAt.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })
                        : '—'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </Card>
      )}
    </section>
  )
}
