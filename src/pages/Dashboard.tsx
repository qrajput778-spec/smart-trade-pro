import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { doc, onSnapshot } from 'firebase/firestore'
import { Area, AreaChart, ResponsiveContainer, YAxis } from 'recharts'
import { ArrowDownCircle, ArrowUpCircle } from 'lucide-react'
import Card from '../components/Card'
import Button from '../components/Button'
import Badge from '../components/Badge'
import MarketCard from '../components/MarketCard'
import MiniStat from '../components/MiniStat'
import PageContainer from '../components/PageContainer'
import WatchlistTable from '../components/WatchlistTable'
import { useAuth } from '../context/AuthContext'
import { useMarketData } from '../context/MarketDataContext'
import { db } from '../lib/firebase'
import { usePortfolioSnapshots } from '../hooks/usePortfolioSnapshots'
import { useWatchlist } from '../hooks/useWatchlist'
import { summarizeHoldings } from '../lib/portfolioMath'
import { TRACKED_SYMBOLS, formatUsd } from '../lib/constants'
import type { HoldingsMap } from '../types'

interface AccountSnapshot {
  displayName: string
  balance: number
  holdings: HoldingsMap
}

// A brand-new account (or one with a single trade) has fewer than 2 real
// snapshots — a flat line at the current value is genuinely accurate there,
// not a placeholder standing in for data we don't have.
const FLAT_LINE_POINTS = 12

export default function Dashboard() {
  const { user } = useAuth()
  const { prices, loading: pricesLoading } = useMarketData()
  const { snapshots } = usePortfolioSnapshots(user?.uid)
  const { watchlist, toggleSymbol } = useWatchlist(user?.uid)

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

    // Live subscription (not a one-time get) so balance and holdings changes
    // reflect here immediately.
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

  // Shared with Portfolio.tsx so the two pages can never silently disagree
  // on what "current value" or "unrealized P&L" means.
  const { knownRows, pending: summaryPending, holdingsValue } = summarizeHoldings(account.holdings, prices)

  const totalPortfolioValue = account.balance + holdingsValue

  // "Today's" change: cash never moves, so this is the real 24h change of
  // each holding weighted by how much of the portfolio it makes up — not a
  // fabricated number, just a value-weighted average of live 24h changes.
  const weightedChangePct =
    summaryPending || totalPortfolioValue <= 0
      ? null
      : (knownRows.reduce((sum, row) => sum + (row.currentValue ?? 0) * row.change24h, 0) / totalPortfolioValue)

  const portfolioHistory = summaryPending
    ? []
    : snapshots.length >= 2
      ? snapshots.map((point) => ({ point: point.id, value: point.totalValue }))
      : Array.from({ length: FLAT_LINE_POINTS }, (_, i) => ({ point: String(i), value: totalPortfolioValue }))

  return (
    <PageContainer>
      <header>
        <h1 className="text-2xl font-semibold text-text-primary">
          Welcome back, {account.displayName}
        </h1>
        <p className="mt-1 text-sm text-text-muted">{today}</p>
      </header>

      <div className="mt-8 grid gap-4 lg:grid-cols-3">
        {/* Total Portfolio Value hero card */}
        <Card className="lg:col-span-2">
          <div className="flex items-center justify-between">
            <span className="text-xs uppercase tracking-wide text-text-muted">Total Portfolio Value</span>
            <Badge tone={weightedChangePct === null ? 'neutral' : weightedChangePct >= 0 ? 'success' : 'danger'}>
              {weightedChangePct === null
                ? '— today'
                : `${weightedChangePct >= 0 ? '+' : ''}${weightedChangePct.toFixed(2)}% today`}
            </Badge>
          </div>

          {summaryPending ? (
            <div className="mt-2 h-9 w-48 animate-pulse rounded bg-surface-alt" />
          ) : (
            <p className="mt-2 font-mono text-3xl text-text-primary">{formatUsd(totalPortfolioValue)}</p>
          )}

          <div className="mt-4 h-24">
            {portfolioHistory.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={portfolioHistory} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
                  <defs>
                    <linearGradient id="portfolioSparkline" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#FFD700" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="#FFD700" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <YAxis hide domain={['dataMin - 1', 'dataMax + 1']} />
                  <Area
                    type="monotone"
                    dataKey="value"
                    stroke="#FFD700"
                    strokeWidth={2}
                    fill="url(#portfolioSparkline)"
                    isAnimationActive={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-full items-center justify-center font-mono text-xs text-text-muted">
                Loading…
              </div>
            )}
          </div>
          <p className="mt-1 text-[11px] text-text-muted">
            {snapshots.length >= 2
              ? 'Real portfolio value at each of your trades.'
              : "You don't have enough trade history yet for a real chart, so this shows a flat line at your current value."}
          </p>

          <div className="mt-5 grid grid-cols-3 gap-3 border-t border-border pt-4">
            <MiniStat label="Available Cash" value={formatUsd(account.balance)} />
            <MiniStat label="Invested" value={summaryPending ? null : formatUsd(holdingsValue)} />
            <MiniStat label="Buying Power" value={formatUsd(account.balance)} />
          </div>
        </Card>

        {/* Quick Actions */}
        <Card className="flex flex-col">
          <span className="text-xs uppercase tracking-wide text-text-muted">Quick Actions</span>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <Link to="/markets">
              <Button variant="primary" className="flex w-full items-center justify-center gap-2">
                <ArrowUpCircle size={16} /> Buy
              </Button>
            </Link>
            <Link to="/markets">
              <Button variant="secondary" className="flex w-full items-center justify-center gap-2">
                <ArrowDownCircle size={16} /> Sell
              </Button>
            </Link>
          </div>
          <p className="mt-auto pt-4 text-[11px] text-text-muted">
            Buy/Sell open the trading terminal once you pick a market — order execution isn't
            built yet.
          </p>
        </Card>
      </div>

      {/* Market Overview */}
      <section className="mt-10">
        <h2 className="text-lg font-semibold text-text-primary">Market Overview</h2>
        <div className="mt-4 grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-4">
          {TRACKED_SYMBOLS.map((symbol) => {
            const coin = prices.find((price) => price.symbol === symbol)
            return <MarketCard key={symbol} coin={coin} loading={pricesLoading || !coin} />
          })}
        </div>
      </section>

      {/* My Watchlist */}
      <section className="mt-10">
        <h2 className="text-lg font-semibold text-text-primary">My Watchlist</h2>
        {(() => {
          const starredSymbols = TRACKED_SYMBOLS.filter((symbol) => watchlist.includes(symbol))
          return starredSymbols.length === 0 ? (
            <Card className="mt-4 py-8 text-center text-sm text-text-muted">
              You haven't added anything to your watchlist yet.{' '}
              <Link to="/watchlist" className="text-accent-gold hover:underline">
                Manage watchlist
              </Link>
            </Card>
          ) : (
            <Card className="mt-4 p-0">
              <WatchlistTable
                prices={prices}
                loading={pricesLoading}
                symbols={starredSymbols}
                watchlist={watchlist}
                onToggleStar={toggleSymbol}
              />
            </Card>
          )
        })()}
      </section>
    </PageContainer>
  )
}
