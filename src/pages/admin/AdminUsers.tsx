import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { collection, getDocs } from 'firebase/firestore'
import { Search, ShieldCheck } from 'lucide-react'
import Card from '../../components/Card'
import PageContainer from '../../components/PageContainer'
import { useMarketData } from '../../context/MarketDataContext'
import { db } from '../../lib/firebase'
import { formatUsd } from '../../lib/constants'
import { summarizeHoldings } from '../../lib/portfolioMath'
import type { HoldingsMap } from '../../types'

interface AdminUserRow {
  uid: string
  displayName: string
  email: string
  balance: number
  holdings: HoldingsMap
  createdAt: Date | null
}

export default function AdminUsers() {
  const navigate = useNavigate()
  const { prices } = useMarketData()

  const [rows, setRows] = useState<AdminUserRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')

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
            Read-only. Balances and portfolio values are simulated virtual funds.
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
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-text-muted">
                  Loading users…
                </td>
              </tr>
            ) : visibleRows.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-text-muted">
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
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </Card>
    </PageContainer>
  )
}
