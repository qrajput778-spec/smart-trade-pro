import { useEffect, useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { collection, doc, getDocs, onSnapshot, orderBy, query } from 'firebase/firestore'
import { AlertTriangle, ArrowLeft, CheckCircle2, ShieldCheck } from 'lucide-react'
import Card from '../../components/Card'
import Button from '../../components/Button'
import TextField from '../../components/TextField'
import PageContainer from '../../components/PageContainer'
import { useAuth } from '../../context/AuthContext'
import { useMarketData } from '../../context/MarketDataContext'
import { db } from '../../lib/firebase'
import { formatUsd } from '../../lib/constants'
import { summarizeHoldings } from '../../lib/portfolioMath'
import { adjustUserBalance, AdminActionError } from '../../lib/admin'
import type { HoldingsMap } from '../../types'

interface AccountState {
  displayName: string
  email: string
  balance: number
  holdings: HoldingsMap
  totalRealizedPnl: number
  createdAt: Date | null
}

interface TransactionRow {
  id: string
  type: 'buy' | 'sell'
  symbol: string
  qty: number
  price: number
  total: number
  realizedPnl?: number
  timestamp: Date | null
}

interface SnapshotRow {
  id: string
  totalValue: number
  cash: number
  holdingsValue: number
  timestamp: Date | null
}

export default function AdminUserDetail() {
  const { uid } = useParams<{ uid: string }>()
  const { user: adminUser } = useAuth()
  const { prices } = useMarketData()

  const [account, setAccount] = useState<AccountState | null>(null)
  const [accountLoading, setAccountLoading] = useState(true)
  const [accountError, setAccountError] = useState<string | null>(null)

  const [transactions, setTransactions] = useState<TransactionRow[]>([])
  const [snapshots, setSnapshots] = useState<SnapshotRow[]>([])
  const [historyLoading, setHistoryLoading] = useState(true)

  const [newBalanceInput, setNewBalanceInput] = useState('')
  const [reason, setReason] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [actionSuccess, setActionSuccess] = useState<string | null>(null)

  useEffect(() => {
    if (!uid || !db) {
      setAccountError('Firebase is not configured yet — add your project keys to .env.')
      setAccountLoading(false)
      return
    }

    const unsubscribe = onSnapshot(
      doc(db, 'users', uid),
      (snapshot) => {
        if (!snapshot.exists()) {
          setAccountError('This account could not be found.')
          setAccountLoading(false)
          return
        }
        const data = snapshot.data()
        const createdAt = data.createdAt
        setAccount({
          displayName: typeof data.displayName === 'string' ? data.displayName : '(no name)',
          email: typeof data.email === 'string' ? data.email : '—',
          balance: typeof data.balance === 'number' ? data.balance : 0,
          holdings: (data.holdings as HoldingsMap | undefined) ?? {},
          totalRealizedPnl: typeof data.totalRealizedPnl === 'number' ? data.totalRealizedPnl : 0,
          createdAt: createdAt && typeof createdAt.toDate === 'function' ? createdAt.toDate() : null,
        })
        setAccountError(null)
        setAccountLoading(false)
      },
      (err) => {
        // eslint-disable-next-line no-console
        console.error('[admin] failed to load target account', err)
        setAccountError('Could not load this account. The admin Firestore rules may not be deployed yet.')
        setAccountLoading(false)
      },
    )

    return unsubscribe
  }, [uid])

  useEffect(() => {
    if (!uid || !db) {
      setHistoryLoading(false)
      return
    }

    let cancelled = false

    async function loadHistory() {
      try {
        const firestore = db!
        const [txSnapshot, snapSnapshot] = await Promise.all([
          getDocs(query(collection(firestore, 'users', uid!, 'transactions'), orderBy('timestamp', 'desc'))),
          getDocs(query(collection(firestore, 'users', uid!, 'portfolioSnapshots'), orderBy('timestamp', 'desc'))),
        ])
        if (cancelled) return

        setTransactions(
          txSnapshot.docs.map((docSnapshot) => {
            const data = docSnapshot.data()
            const timestamp = data.timestamp
            return {
              id: docSnapshot.id,
              type: data.type === 'sell' ? 'sell' : 'buy',
              symbol: String(data.symbol ?? ''),
              qty: typeof data.qty === 'number' ? data.qty : 0,
              price: typeof data.price === 'number' ? data.price : 0,
              total: typeof data.total === 'number' ? data.total : 0,
              realizedPnl: typeof data.realizedPnl === 'number' ? data.realizedPnl : undefined,
              timestamp: timestamp?.toDate ? timestamp.toDate() : null,
            }
          }),
        )
        setSnapshots(
          snapSnapshot.docs.map((docSnapshot) => {
            const data = docSnapshot.data()
            const timestamp = data.timestamp
            return {
              id: docSnapshot.id,
              totalValue: typeof data.totalValue === 'number' ? data.totalValue : 0,
              cash: typeof data.cash === 'number' ? data.cash : 0,
              holdingsValue: typeof data.holdingsValue === 'number' ? data.holdingsValue : 0,
              timestamp: timestamp?.toDate ? timestamp.toDate() : null,
            }
          }),
        )
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[admin] failed to load account history', err)
      } finally {
        if (!cancelled) setHistoryLoading(false)
      }
    }

    loadHistory()
    return () => {
      cancelled = true
    }
  }, [uid])

  async function handleAdjustBalance(event: FormEvent) {
    event.preventDefault()
    if (!uid || !adminUser) return

    setActionError(null)
    setActionSuccess(null)

    const parsed = Number.parseFloat(newBalanceInput)
    if (!Number.isFinite(parsed) || parsed < 0) {
      setActionError('Enter a valid balance of zero or more.')
      return
    }
    if (!reason.trim()) {
      setActionError('A reason is required for accountability.')
      return
    }
    if (
      !window.confirm(
        `Set this user's virtual balance to ${formatUsd(parsed)}? This is a simulated-funds ` +
          'adjustment only, logged with your admin uid and the reason you entered.',
      )
    ) {
      return
    }

    setSubmitting(true)
    try {
      const result = await adjustUserBalance(adminUser.uid, uid, parsed, reason)
      setActionSuccess(
        `Balance updated: ${formatUsd(result.previousBalance)} → ${formatUsd(result.newBalance)}.`,
      )
      setNewBalanceInput('')
      setReason('')
    } catch (err) {
      setActionError(err instanceof AdminActionError ? err.message : 'Could not adjust balance — please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  if (accountLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div
          className="h-8 w-8 animate-spin rounded-full border-2 border-border border-t-accent-gold"
          role="status"
          aria-label="Loading account"
        />
      </div>
    )
  }

  if (accountError || !account) {
    return (
      <PageContainer>
        <p className="text-danger">{accountError ?? 'Something went wrong loading this account.'}</p>
      </PageContainer>
    )
  }

  const { rows, holdingsValue, totalUnrealizedPnl, totalCostBasis } = summarizeHoldings(account.holdings, prices)
  const totalPortfolioValue = account.balance + holdingsValue

  return (
    <PageContainer>
      <Link to="/admin/users" className="inline-flex items-center gap-1 text-sm text-text-muted hover:text-text-primary">
        <ArrowLeft size={14} /> Back to all users
      </Link>

      <header className="mt-4 flex items-center gap-2">
        <ShieldCheck size={22} className="text-accent-gold" />
        <div>
          <h1 className="text-2xl font-semibold text-text-primary">{account.displayName}</h1>
          <p className="mt-1 text-sm text-text-muted">
            {account.email} · Joined{' '}
            {account.createdAt
              ? account.createdAt.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
              : '—'}
          </p>
        </div>
      </header>

      <div className="mt-8 grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-4">
        <Card>
          <span className="text-xs uppercase tracking-wide text-text-muted">Cash Balance (simulated)</span>
          <p className="mt-2 font-mono text-2xl text-text-primary">{formatUsd(account.balance)}</p>
        </Card>
        <Card>
          <span className="text-xs uppercase tracking-wide text-text-muted">Portfolio Value</span>
          <p className="mt-2 font-mono text-2xl text-text-primary">{formatUsd(totalPortfolioValue)}</p>
        </Card>
        <Card>
          <span className="text-xs uppercase tracking-wide text-text-muted">Unrealized P&amp;L</span>
          <p className={`mt-2 font-mono text-2xl ${totalUnrealizedPnl >= 0 ? 'text-success' : 'text-danger'}`}>
            {totalUnrealizedPnl >= 0 ? '+' : ''}
            {formatUsd(totalUnrealizedPnl)}
          </p>
        </Card>
        <Card>
          <span className="text-xs uppercase tracking-wide text-text-muted">Realized P&amp;L</span>
          <p className={`mt-2 font-mono text-2xl ${account.totalRealizedPnl >= 0 ? 'text-success' : 'text-danger'}`}>
            {account.totalRealizedPnl >= 0 ? '+' : ''}
            {formatUsd(account.totalRealizedPnl)}
          </p>
        </Card>
      </div>

      {/* Holdings */}
      <section className="mt-10">
        <h2 className="text-lg font-semibold text-text-primary">Holdings</h2>
        <p className="text-xs text-text-muted">Cost basis (sum of qty × avg buy price): {formatUsd(totalCostBasis)}</p>
        {rows.length === 0 ? (
          <Card className="mt-4 py-8 text-center text-sm text-text-muted">No open positions.</Card>
        ) : (
          <Card className="mt-4 overflow-x-auto p-0">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-text-muted">
                  <th className="px-4 py-3 font-medium">Symbol</th>
                  <th className="px-4 py-3 font-medium">Qty</th>
                  <th className="px-4 py-3 font-medium">Avg Buy Price</th>
                  <th className="px-4 py-3 font-medium">Current Value</th>
                  <th className="px-4 py-3 font-medium">Unrealized P&amp;L</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.symbol} className="border-b border-border last:border-0">
                    <td className="px-4 py-3 font-mono font-semibold text-text-primary">{row.symbol}</td>
                    <td className="px-4 py-3 font-mono text-text-primary">{row.qty}</td>
                    <td className="px-4 py-3 font-mono text-text-primary">{formatUsd(row.avgBuyPrice)}</td>
                    <td className="px-4 py-3 font-mono text-text-primary">
                      {row.currentValue !== null ? formatUsd(row.currentValue) : '—'}
                    </td>
                    <td
                      className={`px-4 py-3 font-mono ${
                        row.pnlAbs === null ? 'text-text-muted' : row.pnlAbs >= 0 ? 'text-success' : 'text-danger'
                      }`}
                    >
                      {row.pnlAbs !== null ? `${row.pnlAbs >= 0 ? '+' : ''}${formatUsd(row.pnlAbs)}` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}
      </section>

      {/* Transaction history */}
      <section className="mt-10">
        <h2 className="text-lg font-semibold text-text-primary">Transaction History</h2>
        {historyLoading ? (
          <Card className="mt-4 animate-pulse py-8 text-center text-sm text-text-muted">Loading…</Card>
        ) : transactions.length === 0 ? (
          <Card className="mt-4 py-8 text-center text-sm text-text-muted">No trades yet.</Card>
        ) : (
          <Card className="mt-4 overflow-x-auto p-0">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-text-muted">
                  <th className="px-4 py-3 font-medium">Type</th>
                  <th className="px-4 py-3 font-medium">Symbol</th>
                  <th className="px-4 py-3 font-medium">Qty</th>
                  <th className="px-4 py-3 font-medium">Price</th>
                  <th className="px-4 py-3 font-medium">Total</th>
                  <th className="px-4 py-3 font-medium">Date</th>
                </tr>
              </thead>
              <tbody>
                {transactions.map((tx) => (
                  <tr key={tx.id} className="border-b border-border last:border-0">
                    <td
                      className={`px-4 py-3 font-mono text-xs font-semibold uppercase ${
                        tx.type === 'buy' ? 'text-success' : 'text-danger'
                      }`}
                    >
                      {tx.type}
                    </td>
                    <td className="px-4 py-3 font-mono text-text-primary">{tx.symbol}</td>
                    <td className="px-4 py-3 font-mono text-text-primary">{tx.qty}</td>
                    <td className="px-4 py-3 font-mono text-text-primary">{formatUsd(tx.price)}</td>
                    <td className="px-4 py-3 font-mono text-text-primary">{formatUsd(tx.total)}</td>
                    <td className="px-4 py-3 text-text-muted">
                      {tx.timestamp
                        ? tx.timestamp.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}
      </section>

      {/* Portfolio snapshots */}
      <section className="mt-10">
        <h2 className="text-lg font-semibold text-text-primary">Portfolio Snapshots</h2>
        {historyLoading ? (
          <Card className="mt-4 animate-pulse py-8 text-center text-sm text-text-muted">Loading…</Card>
        ) : snapshots.length === 0 ? (
          <Card className="mt-4 py-8 text-center text-sm text-text-muted">No snapshots recorded yet.</Card>
        ) : (
          <Card className="mt-4 overflow-x-auto p-0">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-text-muted">
                  <th className="px-4 py-3 font-medium">Total Value</th>
                  <th className="px-4 py-3 font-medium">Cash</th>
                  <th className="px-4 py-3 font-medium">Holdings Value</th>
                  <th className="px-4 py-3 font-medium">Date</th>
                </tr>
              </thead>
              <tbody>
                {snapshots.map((snap) => (
                  <tr key={snap.id} className="border-b border-border last:border-0">
                    <td className="px-4 py-3 font-mono text-text-primary">{formatUsd(snap.totalValue)}</td>
                    <td className="px-4 py-3 font-mono text-text-primary">{formatUsd(snap.cash)}</td>
                    <td className="px-4 py-3 font-mono text-text-primary">{formatUsd(snap.holdingsValue)}</td>
                    <td className="px-4 py-3 text-text-muted">
                      {snap.timestamp
                        ? snap.timestamp.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}
      </section>

      {/* Admin action */}
      <section className="mt-10">
        <Card className="border-danger/40">
          <div className="flex items-center gap-2">
            <AlertTriangle size={16} className="text-danger" />
            <h2 className="text-sm font-semibold uppercase tracking-wide text-danger">
              Adjust Virtual Balance (testing only)
            </h2>
          </div>
          <p className="mt-2 text-xs text-text-muted">
            This sets this user's simulated cash balance to an exact number for QA/support
            purposes. It is not a deposit, withdrawal, or real transaction of any kind — there is
            no funding source and no destination, just a number being reset. Every change is
            logged with your admin account, the reason you give, and the before/after values.
          </p>

          <form onSubmit={handleAdjustBalance} className="mt-4 grid gap-4 sm:grid-cols-2" noValidate>
            <TextField
              label="New balance (USD, simulated)"
              name="newBalance"
              type="number"
              min="0"
              step="0.01"
              value={newBalanceInput}
              onChange={(event) => setNewBalanceInput(event.target.value)}
              placeholder={account.balance.toString()}
            />
            <TextField
              label="Reason (required)"
              name="reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="e.g. QA reset for testing scenario X"
            />

            {actionError && <p className="text-xs text-danger sm:col-span-2">{actionError}</p>}
            {actionSuccess && (
              <p className="flex items-center gap-1.5 text-xs text-success sm:col-span-2">
                <CheckCircle2 size={14} /> {actionSuccess}
              </p>
            )}

            <div className="sm:col-span-2">
              <Button type="submit" variant="danger" disabled={submitting}>
                {submitting ? 'Adjusting…' : 'Adjust Balance'}
              </Button>
            </div>
          </form>
        </Card>
      </section>
    </PageContainer>
  )
}
