import { useEffect, useState, type MouseEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { collection, getDocs } from 'firebase/firestore'
import { AlertTriangle, Search, ShieldCheck, UserX } from 'lucide-react'
import Card from '../../components/Card'
import Button from '../../components/Button'
import TextField from '../../components/TextField'
import PageContainer from '../../components/PageContainer'
import { useAuth } from '../../context/AuthContext'
import { useMarketData } from '../../context/MarketDataContext'
import { db } from '../../lib/firebase'
import { formatUsd } from '../../lib/constants'
import { summarizeHoldings } from '../../lib/portfolioMath'
import { removeUserAccount, AdminActionError, RemoveUserPartialError } from '../../lib/admin'
import type { HoldingsMap } from '../../types'

interface AdminUserRow {
  uid: string
  displayName: string
  email: string
  balance: number
  holdings: HoldingsMap
  createdAt: Date | null
  isAdmin: boolean
}

export default function AdminUsers() {
  const navigate = useNavigate()
  const { user: adminUser } = useAuth()
  const { prices } = useMarketData()

  const [rows, setRows] = useState<AdminUserRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')

  // ---- Remove user (inline, right from the list) ----
  const [removeTarget, setRemoveTarget] = useState<AdminUserRow | null>(null)
  const [removeReason, setRemoveReason] = useState('')
  const [removeConfirmText, setRemoveConfirmText] = useState('')
  const [removing, setRemoving] = useState(false)
  const [removeError, setRemoveError] = useState<string | null>(null)

  function openRemoveDialog(row: AdminUserRow, event: MouseEvent) {
    event.stopPropagation() // don't also trigger the row's own "go to detail" click
    setRemoveTarget(row)
    setRemoveReason('')
    setRemoveConfirmText('')
    setRemoveError(null)
  }

  function closeRemoveDialog() {
    setRemoveTarget(null)
    setRemoveReason('')
    setRemoveConfirmText('')
    setRemoveError(null)
  }

  async function handleRemoveUser() {
    if (!removeTarget || !adminUser || removeConfirmText !== 'REMOVE') return

    setRemoveError(null)
    setRemoving(true)
    try {
      await removeUserAccount(adminUser.uid, adminUser.email, removeTarget.uid, removeReason)
      // Only reached once Firebase Auth deletion AND every piece of this
      // account's Firestore/Storage data have actually been removed — see
      // src/lib/admin.ts's removeUserAccount. Never shown for a run that
      // only got partway (that throws RemoveUserPartialError below instead,
      // which deliberately keeps the row and the dialog open so the reason
      // typed in survives a retry click).
      setRows((prev) => prev.filter((row) => row.uid !== removeTarget.uid))
      closeRemoveDialog()
    } catch (err) {
      if (err instanceof RemoveUserPartialError) {
        // The Auth account is already gone — this person can no longer sign
        // in — but some of their data cleanup failed partway. Keep the row
        // and the dialog open (with the reason still filled in) so Remove
        // can just be clicked again; every step it retries is a no-op for
        // whatever already succeeded.
        setRemoveError(err.message)
      } else {
        setRemoveError(err instanceof AdminActionError ? err.message : 'Could not remove this account — please try again.')
      }
    } finally {
      setRemoving(false)
    }
  }

  useEffect(() => {
    if (!db) {
      setError('Firebase is not configured yet — add your project keys to .env.')
      setLoading(false)
      return
    }

    let cancelled = false

    async function load() {
      try {
        const snapshot = await getDocs(collection(db!, 'users'))
        if (cancelled) return
        setRows(
          snapshot.docs.map((docSnapshot) => {
            const data = docSnapshot.data()
            const createdAt = data.createdAt
            return {
              uid: docSnapshot.id,
              displayName: typeof data.displayName === 'string' ? data.displayName : '(no name)',
              email: typeof data.email === 'string' ? data.email : '—',
              balance: typeof data.balance === 'number' ? data.balance : 0,
              holdings: (data.holdings as HoldingsMap | undefined) ?? {},
              createdAt: createdAt && typeof createdAt.toDate === 'function' ? createdAt.toDate() : null,
              isAdmin: data.isAdmin === true,
            }
          }),
        )
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[admin] failed to load users', err)
        setError('Could not load the user list. The admin Firestore rules may not be deployed yet.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [])

  const normalizedQuery = query.trim().toLowerCase()
  const visibleRows = rows.filter((row) => {
    if (!normalizedQuery) return true
    return (
      row.displayName.toLowerCase().includes(normalizedQuery) ||
      row.email.toLowerCase().includes(normalizedQuery)
    )
  })

  return (
    <PageContainer>
      <header className="flex items-center gap-2">
        <ShieldCheck size={22} className="text-accent-gold" />
        <div>
          <h1 className="text-2xl font-semibold text-text-primary">All Users</h1>
          <p className="mt-1 text-sm text-text-muted">
            Read-only account balances and portfolio values.
          </p>
        </div>
      </header>

      <div className="mt-6 flex max-w-sm items-center gap-2 rounded-md border border-border bg-surface-alt px-3 py-2 text-sm text-text-muted focus-within:border-accent-gold">
        <Search size={16} className="flex-none" />
        <input
          type="text"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search by name or email…"
          className="w-full bg-transparent text-text-primary placeholder:text-text-muted focus:outline-none"
        />
      </div>

      {error && (
        <Card className="mt-6 border-danger/40">
          <p className="text-sm text-danger">{error}</p>
        </Card>
      )}

      <Card className="mt-6 overflow-x-auto p-0">
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-text-muted">
              <th className="px-4 py-3 font-medium">Name</th>
              <th className="px-4 py-3 font-medium">Email</th>
              <th className="px-4 py-3 font-medium text-right">Cash Balance</th>
              <th className="px-4 py-3 font-medium text-right">Portfolio Value</th>
              <th className="px-4 py-3 font-medium">Joined</th>
              <th className="px-4 py-3 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-text-muted">
                  Loading users…
                </td>
              </tr>
            ) : visibleRows.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-text-muted">
                  No users match "{query}".
                </td>
              </tr>
            ) : (
              visibleRows.map((row) => {
                const { holdingsValue } = summarizeHoldings(row.holdings, prices)
                return (
                  <tr
                    key={row.uid}
                    onClick={() => navigate(`/admin/users/${row.uid}`)}
                    className="cursor-pointer border-b border-border transition-colors last:border-0 hover:bg-surface-alt"
                  >
                    <td className="px-4 py-3 font-medium text-text-primary">{row.displayName}</td>
                    <td className="px-4 py-3 text-text-muted">{row.email}</td>
                    <td className="px-4 py-3 text-right font-mono text-text-primary">{formatUsd(row.balance)}</td>
                    <td className="px-4 py-3 text-right font-mono text-text-primary">
                      {formatUsd(row.balance + holdingsValue)}
                    </td>
                    <td className="px-4 py-3 text-text-muted">
                      {row.createdAt
                        ? row.createdAt.toLocaleDateString('en-US', {
                            year: 'numeric',
                            month: 'short',
                            day: 'numeric',
                          })
                        : '—'}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {row.isAdmin ? (
                        <span className="text-[11px] text-text-muted">Admin</span>
                      ) : row.uid === adminUser?.uid ? null : (
                        <button
                          type="button"
                          onClick={(event) => openRemoveDialog(row, event)}
                          className="inline-flex items-center gap-1 rounded-md border border-danger/30 px-2 py-1 text-[11px] font-medium text-danger transition-colors hover:bg-danger/10"
                          title={`Remove ${row.displayName}`}
                        >
                          <UserX size={12} /> Remove
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </Card>

      {removeTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
          <Card className="w-full max-w-md border-danger/40">
            <div className="flex items-center gap-2">
              <AlertTriangle size={18} className="text-danger" />
              <h3 className="text-lg font-semibold text-text-primary">Remove {removeTarget.displayName}</h3>
            </div>
            <p className="mt-2 text-sm text-text-muted">
              This permanently deletes {removeTarget.email}'s account: their Firebase sign-in
              credentials (they will no longer be able to log in at all), balance, holdings, trade
              and portfolio history, KYC submissions, deposit/withdrawal requests, and support
              chat — including their uploaded files. This cannot be undone.
            </p>

            <div className="mt-4 space-y-3">
              <TextField
                label="Reason (required)"
                name="removeReason"
                value={removeReason}
                onChange={(event) => setRemoveReason(event.target.value)}
                placeholder="e.g. Account closure requested by user"
              />
              <TextField
                label={'Type "REMOVE" to confirm'}
                name="removeConfirm"
                value={removeConfirmText}
                onChange={(event) => setRemoveConfirmText(event.target.value)}
                placeholder="REMOVE"
              />
            </div>

            {removeError && <p className="mt-3 text-xs text-danger">{removeError}</p>}

            <div className="mt-5 flex justify-end gap-3">
              <Button variant="secondary" onClick={closeRemoveDialog} disabled={removing}>
                Cancel
              </Button>
              <Button
                variant="danger"
                onClick={handleRemoveUser}
                disabled={removeConfirmText !== 'REMOVE' || !removeReason.trim() || removing}
              >
                {removing ? 'Removing…' : 'Permanently Remove User'}
              </Button>
            </div>
          </Card>
        </div>
      )}
    </PageContainer>
  )
}
