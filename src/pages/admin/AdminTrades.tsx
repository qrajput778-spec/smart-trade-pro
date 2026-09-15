import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { collection, collectionGroup, getDocs, limit, onSnapshot, orderBy, query } from 'firebase/firestore'
import { ShieldCheck } from 'lucide-react'
import Card from '../../components/Card'
import PageContainer from '../../components/PageContainer'
import { db } from '../../lib/firebase'
import { formatUsd } from '../../lib/constants'

const TRADES_FEED_LIMIT = 100

interface TradeRow {
  id: string
  uid: string
  type: 'buy' | 'sell'
  symbol: string
  qty: number
  price: number
  total: number
  timestamp: Date | null
}

export default function AdminTrades() {
  const [trades, setTrades] = useState<TradeRow[]>([])
  const [userNames, setUserNames] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // One-time lookup so the feed can show a name instead of a raw uid.
  useEffect(() => {
    if (!db) return
    getDocs(collection(db, 'users'))
      .then((snapshot) => {
        const names: Record<string, string> = {}
        snapshot.forEach((docSnapshot) => {
          const displayName = docSnapshot.data().displayName
          names[docSnapshot.id] = typeof displayName === 'string' ? displayName : docSnapshot.id
        })
        setUserNames(names)
      })
      .catch(() => {
        // Non-fatal — the feed still works, just shows uids instead of names.
      })
  }, [])

  useEffect(() => {
    if (!db) {
      setError('Firebase is not configured yet — add your project keys to .env.')
      setLoading(false)
      return
    }

    // Live feed — collection-group query across every user's transactions
    // subcollection. Requires the draft admin rule + a collection-group
    // index on "timestamp" once set up in Firebase.
    const tradesQuery = query(collectionGroup(db, 'transactions'), orderBy('timestamp', 'desc'), limit(TRADES_FEED_LIMIT))

    const unsubscribe = onSnapshot(
      tradesQuery,
      (snapshot) => {
        setTrades(
          snapshot.docs.map((docSnapshot) => {
            const data = docSnapshot.data()
            const timestamp = data.timestamp
            return {
              id: docSnapshot.id,
              uid: docSnapshot.ref.parent.parent?.id ?? 'unknown',
              type: data.type === 'sell' ? 'sell' : 'buy',
              symbol: String(data.symbol ?? ''),
              qty: typeof data.qty === 'number' ? data.qty : 0,
              price: typeof data.price === 'number' ? data.price : 0,
              total: typeof data.total === 'number' ? data.total : 0,
              timestamp: timestamp?.toDate ? timestamp.toDate() : null,
            }
          }),
        )
        setError(null)
        setLoading(false)
      },
      (err) => {
        // eslint-disable-next-line no-console
        console.error('[admin] failed to load trade feed', err)
        setError(
          'Could not load the trade feed. The admin Firestore rules and/or a collection-group ' +
            'index on "transactions" may not be set up yet.',
        )
        setLoading(false)
      },
    )

    return unsubscribe
  }, [])

  return (
    <PageContainer>
      <header className="flex items-center gap-2">
        <ShieldCheck size={22} className="text-accent-gold" />
        <div>
          <h1 className="text-2xl font-semibold text-text-primary">Trade Feed</h1>
          <p className="mt-1 text-sm text-text-muted">
            Live, read-only view of the {TRADES_FEED_LIMIT} most recent trades across all accounts.
          </p>
        </div>
      </header>

      {error && (
        <Card className="mt-6 border-danger/40">
          <p className="text-sm text-danger">{error}</p>
        </Card>
      )}

      <Card className="mt-6 overflow-x-auto p-0">
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-text-muted">
              <th className="px-4 py-3 font-medium">User</th>
              <th className="px-4 py-3 font-medium">Type</th>
              <th className="px-4 py-3 font-medium">Symbol</th>
              <th className="px-4 py-3 font-medium">Qty</th>
              <th className="px-4 py-3 font-medium">Price</th>
              <th className="px-4 py-3 font-medium">Total</th>
              <th className="px-4 py-3 font-medium">Date</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-text-muted">
                  Loading trades…
                </td>
              </tr>
            ) : trades.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-text-muted">
                  No trades yet.
                </td>
              </tr>
            ) : (
              trades.map((trade) => (
                <tr key={trade.id} className="border-b border-border last:border-0">
                  <td className="px-4 py-3 text-text-primary">
                    <Link to={`/admin/users/${trade.uid}`} className="hover:text-accent-gold hover:underline">
                      {userNames[trade.uid] ?? trade.uid}
                    </Link>
                  </td>
                  <td
                    className={`px-4 py-3 font-mono text-xs font-semibold uppercase ${
                      trade.type === 'buy' ? 'text-success' : 'text-danger'
                    }`}
                  >
                    {trade.type}
                  </td>
                  <td className="px-4 py-3 font-mono text-text-primary">{trade.symbol}</td>
                  <td className="px-4 py-3 font-mono text-text-primary">{trade.qty}</td>
                  <td className="px-4 py-3 font-mono text-text-primary">{formatUsd(trade.price)}</td>
                  <td className="px-4 py-3 font-mono text-text-primary">{formatUsd(trade.total)}</td>
                  <td className="px-4 py-3 text-text-muted">
                    {trade.timestamp
                      ? trade.timestamp.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })
                      : '—'}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </Card>
    </PageContainer>
  )
}
