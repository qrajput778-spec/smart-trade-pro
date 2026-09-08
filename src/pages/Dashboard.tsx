import { useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { doc, onSnapshot } from 'firebase/firestore'
import { LineChart, Layers, TrendingDown, TrendingUp, Wallet } from 'lucide-react'
import Card from '../components/Card'
import Button from '../components/Button'
import { useAuth } from '../context/AuthContext'
import { useMarketPrices } from '../hooks/useMarketPrices'
import { db } from '../lib/firebase'
import { formatUsd } from '../lib/constants'
import type { HoldingsMap } from '../types'

interface AccountSnapshot {
  displayName: string
  balance: number
  holdings: HoldingsMap
}

export default function Dashboard() {
  const { user } = useAuth()
  const { prices, loading: pricesLoading } = useMarketPrices()

  const [account, setAccount] = useState<AccountSnapshot | null>(null)
  const [accountLoading, setAccountLoading] = useState(true)
  const [accountError, setAccountError] = useState<string | null>(null)

  useEffect(() => {
    if (!user) return

    if (!db) {
      setAccountError('Firebase is not configured yet — add your project keys to .env.')
      setAccountLoading(false)
      return
    }

    // Live subscription (not a one-time get) so balance/holdings changes made
    // elsewhere (e.g. a future Trade page) show up here immediately.
    const unsubscribe = onSnapshot(
      doc(db, 'users', user.uid),
      (snapshot) => {
        const data = snapshot.data()
        setAccount({
          displayName: (data?.displayName as string | undefined) || user.displayName || 'trader',
          balance: typeof data?.balance === 'number' ? data.balance : 0,
          holdings: (data?.holdings as HoldingsMap | undefined) ?? {},
        })
        setAccountError(null)
        setAccountLoading(false)
      },
      (err) => {
        // eslint-disable-next-line no-console
        console.error('[dashboard] account snapshot error', err)
        setAccountError('Could not load your account — please try again shortly.')
        setAccountLoading(false)
      },
    )

    return unsubscribe
  }, [user])

  if (accountLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div
          className="h-8 w-8 animate-spin rounded-full border-2 border-border border-t-accent-gold"
          role="status"
          aria-label="Loading your account"
        />
      </div>
    )
  }

  if (accountError || !account) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-16 text-center">
        <p className="text-danger">{accountError ?? 'Something went wrong loading your account.'}</p>
      </div>
    )
  }

  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })

  const holdingEntries = Object.entries(account.holdings)

  const rows = holdingEntries.map(([symbol, holding]) => {
    const coin = prices.find((price) => price.symbol === symbol)
    const priceKnown = Boolean(coin && coin.price > 0)
    const currentPrice = coin?.price ?? 0
    const costBasis = holding.qty * holding.avgBuyPrice
    const currentValue = priceKnown ? holding.qty * currentPrice : null
    const pnlAbs = currentValue !== null ? currentValue - costBasis : null
    const pnlPct = pnlAbs !== null && costBasis > 0 ? (pnlAbs / costBasis) * 100 : null
    return { symbol, holding, currentPrice, currentValue, pnlAbs, pnlPct, priceKnown }
  })

  const knownRows = rows.filter((row) => row.priceKnown)
  // Only block the summary stats on price loading while there's actually a
  // holding whose price we don't have yet — an empty portfolio never waits.
  const summaryPending = rows.length > 0 && knownRows.length < rows.length && pricesLoading

  const holdingsValue = knownRows.reduce((sum, row) => sum + (row.currentValue ?? 0), 0)
  const totalPnl = knownRows.reduce((sum, row) => sum + (row.pnlAbs ?? 0), 0)
  const totalPortfolioValue = account.balance + holdingsValue

  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      <header>
        <h1 className="text-2xl font-semibold text-text-primary">
          Welcome back, {account.displayName}
        </h1>
        <p className="mt-1 text-sm text-text-muted">{today}</p>
      </header>

      <div className="mt-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <SummaryCard icon={<Wallet size={16} />} label="Virtual Cash Balance" value={formatUsd(account.balance)} />
        <SummaryCard
          icon={<Layers size={16} />}
          label="Total Portfolio Value"
          value={summaryPending ? null : formatUsd(totalPortfolioValue)}
        />
        <SummaryCard
          icon={totalPnl >= 0 ? <TrendingUp size={16} /> : <TrendingDown size={16} />}
          label="Total Unrealized P&L"
          value={summaryPending ? null : `${totalPnl >= 0 ? '+' : ''}${formatUsd(totalPnl)}`}
          tone={summaryPending ? undefined : totalPnl >= 0 ? 'success' : 'danger'}
        />
        <SummaryCard icon={<LineChart size={16} />} label="Open Positions" value={String(holdingEntries.length)} />
      </div>

      <section className="mt-10">
        <h2 className="text-lg font-semibold text-text-primary">Holdings</h2>

        {holdingEntries.length === 0 ? (
          <Card className="mt-4 flex flex-col items-center gap-3 py-12 text-center">
            <p className="max-w-sm text-text-muted">
              You don't have any open positions yet — every balance here is simulated.
            </p>
            <Link to="/markets">
              <Button variant="primary">Explore markets to place your first trade</Button>
            </Link>
          </Card>
        ) : (
          <Card className="mt-4 overflow-x-auto p-0">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-text-muted">
                  <th className="px-4 py-3 font-medium">Symbol</th>
                  <th className="px-4 py-3 font-medium">Qty</th>
                  <th className="px-4 py-3 font-medium">Avg Buy Price</th>
                  <th className="px-4 py-3 font-medium">Current Price</th>
                  <th className="px-4 py-3 font-medium">Current Value</th>
                  <th className="px-4 py-3 font-medium">P&amp;L</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.symbol} className="border-b border-border last:border-0">
                    <td className="px-4 py-3 font-mono font-semibold text-text-primary">{row.symbol}</td>
                    <td className="px-4 py-3 font-mono text-text-primary">{row.holding.qty}</td>
                    <td className="px-4 py-3 font-mono text-text-primary">
                      {formatUsd(row.holding.avgBuyPrice)}
                    </td>
                    {row.priceKnown ? (
                      <>
                        <td className="px-4 py-3 font-mono text-text-primary">
                          {formatUsd(row.currentPrice)}
                        </td>
                        <td className="px-4 py-3 font-mono text-text-primary">
                          {formatUsd(row.currentValue ?? 0)}
                        </td>
                        <td
                          className={`px-4 py-3 font-mono ${
                            (row.pnlAbs ?? 0) >= 0 ? 'text-success' : 'text-danger'
                          }`}
                        >
                          {(row.pnlAbs ?? 0) >= 0 ? '+' : ''}
                          {formatUsd(row.pnlAbs ?? 0)}{' '}
                          {row.pnlPct !== null && (
                            <span className="text-xs">
                              ({row.pnlPct >= 0 ? '+' : ''}
                              {row.pnlPct.toFixed(2)}%)
                            </span>
                          )}
                        </td>
                      </>
                    ) : (
                      <td colSpan={3} className="px-4 py-3">
                        <div className="h-4 w-full max-w-[200px] animate-pulse rounded bg-surface-alt" />
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}
      </section>

      <section className="mt-10 grid gap-4 sm:grid-cols-2">
        <Link to="/markets">
          <Card className="flex items-center justify-between transition-colors hover:border-accent-gold/40">
            <div>
              <p className="font-semibold text-text-primary">View Markets</p>
              <p className="mt-1 text-sm text-text-muted">Check live prices across tracked coins.</p>
            </div>
            <LineChart size={20} className="text-accent-gold" />
          </Card>
        </Link>
        <Link to="/portfolio">
          <Card className="flex items-center justify-between transition-colors hover:border-accent-gold/40">
            <div>
              <p className="font-semibold text-text-primary">Portfolio</p>
              <p className="mt-1 text-sm text-text-muted">Review your full position history.</p>
            </div>
            <Wallet size={20} className="text-accent-gold" />
          </Card>
        </Link>
      </section>
    </div>
  )
}

function SummaryCard({
  icon,
  label,
  value,
  tone,
}: {
  icon: ReactNode
  label: string
  value: string | null
  tone?: 'success' | 'danger'
}) {
  const toneClass = tone === 'success' ? 'text-success' : tone === 'danger' ? 'text-danger' : 'text-text-primary'
  return (
    <Card>
      <div className="flex items-center gap-2 text-text-muted">
        {icon}
        <span className="text-xs uppercase tracking-wide">{label}</span>
      </div>
      {value === null ? (
        <div className="mt-3 h-6 w-20 animate-pulse rounded bg-surface-alt" />
      ) : (
        <p className={`mt-2 font-mono text-xl ${toneClass}`}>{value}</p>
      )}
    </Card>
  )
}
