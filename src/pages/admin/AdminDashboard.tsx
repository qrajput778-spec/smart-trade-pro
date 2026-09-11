import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { collection, collectionGroup, getCountFromServer, getDocs } from 'firebase/firestore'
import { ArrowRight, LineChart, ShieldCheck, Users } from 'lucide-react'
import Card from '../../components/Card'
import PageContainer from '../../components/PageContainer'
import { db } from '../../lib/firebase'
import { formatUsd } from '../../lib/constants'

interface AdminStats {
  totalUsers: number
  totalTrades: number
  totalVolume: number
  mostTradedSymbol: string | null
}

export default function AdminDashboard() {
  const [stats, setStats] = useState<AdminStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!db) {
      setError('Firebase is not configured yet — add your project keys to .env.')
      setLoading(false)
      return
    }

    let cancelled = false

    async function load() {
      try {
        const firestore = db!
        const [usersCountSnapshot, transactionsSnapshot] = await Promise.all([
          getCountFromServer(collection(firestore, 'users')),
          // Collection-group read across every user's transactions subcollection.
          // Requires the draft admin rule + a collection-group index on
          // "timestamp" once the rules/index are actually set up in Firebase.
          getDocs(collectionGroup(firestore, 'transactions')),
        ])

        if (cancelled) return

        let totalVolume = 0
        const symbolCounts: Record<string, number> = {}
        transactionsSnapshot.forEach((docSnapshot) => {
          const data = docSnapshot.data()
          if (typeof data.total === 'number') totalVolume += data.total
          if (typeof data.symbol === 'string') {
            symbolCounts[data.symbol] = (symbolCounts[data.symbol] ?? 0) + 1
          }
        })

        let mostTradedSymbol: string | null = null
        let mostTradedCount = 0
        for (const [symbol, count] of Object.entries(symbolCounts)) {
          if (count > mostTradedCount) {
            mostTradedSymbol = symbol
            mostTradedCount = count
          }
        }

        setStats({
          totalUsers: usersCountSnapshot.data().count,
          totalTrades: transactionsSnapshot.size,
          totalVolume,
          mostTradedSymbol,
        })
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[admin] failed to load dashboard stats', err)
        setError(
          'Could not load admin stats. If this just started happening, the admin Firestore ' +
            'rules and/or a collection-group index on "transactions" may not be set up yet.',
        )
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <PageContainer>
      <header className="flex items-center gap-2">
        <ShieldCheck size={22} className="text-accent-gold" />
        <div>
          <h1 className="text-2xl font-semibold text-text-primary">Admin Dashboard</h1>
          <p className="mt-1 text-sm text-text-muted">
            Aggregate, read-only stats across all accounts. Every number here is simulated —
            this is a monitoring view, not a real financial ledger.
          </p>
        </div>
      </header>

      {error && (
        <Card className="mt-6 border-danger/40">
          <p className="text-sm text-danger">{error}</p>
        </Card>
      )}

      <div className="mt-8 grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-4">
        <Card>
          <span className="text-xs uppercase tracking-wide text-text-muted">Total Users</span>
          {loading ? (
            <div className="mt-2 h-8 w-20 animate-pulse rounded bg-surface-alt" />
          ) : (
            <p className="mt-2 font-mono text-2xl text-text-primary">{stats?.totalUsers ?? '—'}</p>
          )}
        </Card>
        <Card>
          <span className="text-xs uppercase tracking-wide text-text-muted">Total Trades Executed</span>
          {loading ? (
            <div className="mt-2 h-8 w-20 animate-pulse rounded bg-surface-alt" />
          ) : (
            <p className="mt-2 font-mono text-2xl text-text-primary">{stats?.totalTrades ?? '—'}</p>
          )}
        </Card>
        <Card>
          <span className="text-xs uppercase tracking-wide text-text-muted">Total Simulated Volume</span>
          {loading ? (
            <div className="mt-2 h-8 w-32 animate-pulse rounded bg-surface-alt" />
          ) : (
            <p className="mt-2 font-mono text-2xl text-text-primary">{formatUsd(stats?.totalVolume ?? 0)}</p>
          )}
        </Card>
        <Card>
          <span className="text-xs uppercase tracking-wide text-text-muted">Most-Traded Symbol</span>
          {loading ? (
            <div className="mt-2 h-8 w-16 animate-pulse rounded bg-surface-alt" />
          ) : (
            <p className="mt-2 font-mono text-2xl text-accent-gold">{stats?.mostTradedSymbol ?? '—'}</p>
          )}
        </Card>
      </div>

      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        <Link to="/admin/users">
          <Card className="flex items-center justify-between transition-colors hover:border-accent-gold/40">
            <div className="flex items-center gap-3">
              <Users size={20} className="text-accent-gold" />
              <div>
                <p className="font-medium text-text-primary">All Users</p>
                <p className="text-xs text-text-muted">Browse every account and its virtual balance.</p>
              </div>
            </div>
            <ArrowRight size={16} className="text-text-muted" />
          </Card>
        </Link>
        <Link to="/admin/trades">
          <Card className="flex items-center justify-between transition-colors hover:border-accent-gold/40">
            <div className="flex items-center gap-3">
              <LineChart size={20} className="text-accent-gold" />
              <div>
                <p className="font-medium text-text-primary">Trade Feed</p>
                <p className="text-xs text-text-muted">Most recent simulated trades across all users.</p>
              </div>
            </div>
            <ArrowRight size={16} className="text-text-muted" />
          </Card>
        </Link>
      </div>
    </PageContainer>
  )
}
