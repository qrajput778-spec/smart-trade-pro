import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { doc, increment, onSnapshot, updateDoc } from 'firebase/firestore'
import { Area, AreaChart, ResponsiveContainer, YAxis } from 'recharts'
import { ArrowDownCircle, ArrowUpCircle, PlusCircle, RotateCcw } from 'lucide-react'
import Card from '../components/Card'
import Button from '../components/Button'
import Badge from '../components/Badge'
import MarketCard from '../components/MarketCard'
import WatchlistTable from '../components/WatchlistTable'
import { useAuth } from '../context/AuthContext'
import { useMarketData } from '../context/MarketDataContext'
import { db } from '../lib/firebase'
import { ADD_VIRTUAL_FUNDS_AMOUNT, STARTING_VIRTUAL_BALANCE, TRACKED_SYMBOLS, formatUsd } from '../lib/constants'
import type { HoldingsMap } from '../types'

interface AccountSnapshot {
  displayName: string
  balance: number
  holdings: HoldingsMap
}

type PendingAction = 'add-funds' | 'reset' | null

// Flat sparkline of the current portfolio value — we don't track portfolio
// value history yet, so this deliberately shows a flat line rather than
// faking a growth curve. TODO: replace with real history once a Firestore
// collection records portfolio value snapshots over time.
const HISTORY_PLACEHOLDER_POINTS = 12

export default function Dashboard() {
  const { user } = useAuth()
  const { prices, loading: pricesLoading } = useMarketData()

  const [account, setAccount] = useState<AccountSnapshot | null>(null)
  const [accountLoading, setAccountLoading] = useState(true)
  const [accountError, setAccountError] = useState<string | null>(null)

  const [pendingAction, setPendingAction] = useState<PendingAction>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  useEffect(() => {
    if (!user) return

    if (!db) {
      setAccountError('Firebase is not configured yet — add your project keys to .env.')
      setAccountLoading(false)
      return
    }

    // Live subscription (not a one-time get) so balance/holdings changes —
    // including the quick actions below — reflect here immediately.
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

  async function handleAddFunds() {
    if (!user || !db) return
    const amountLabel = formatUsd(ADD_VIRTUAL_FUNDS_AMOUNT, { maximumFractionDigits: 0 })
    if (!window.confirm(`Add ${amountLabel} in virtual funds to your balance?`)) return

    setPendingAction('add-funds')
    setActionError(null)
    try {
      // Firestore field update only — no payment provider, no real transfer.
      await updateDoc(doc(db, 'users', user.uid), {
        balance: increment(ADD_VIRTUAL_FUNDS_AMOUNT),
      })
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[dashboard] add funds failed', err)
      setActionError('Could not add virtual funds — please try again.')
    } finally {
      setPendingAction(null)
    }
  }

  async function handleResetPortfolio() {
    if (!user || !db) return
    if (
      !window.confirm(
        'Reset your portfolio? This sets your balance back to the starting amount and clears all holdings. This cannot be undone.',
      )
    ) {
      return
    }

    setPendingAction('reset')
    setActionError(null)
    try {
      await updateDoc(doc(db, 'users', user.uid), {
        balance: STARTING_VIRTUAL_BALANCE,
        holdings: {},
      })
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[dashboard] reset portfolio failed', err)
      setActionError('Could not reset your portfolio — please try again.')
    } finally {
      setPendingAction(null)
    }
  }

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
    return { symbol, holding, currentValue, pnlAbs, change24h: coin?.change24h ?? 0, priceKnown }
  })

  const knownRows = rows.filter((row) => row.priceKnown)
  const summaryPending = rows.length > 0 && knownRows.length < rows.length && pricesLoading

  const holdingsValue = knownRows.reduce((sum, row) => sum + (row.currentValue ?? 0), 0)
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
    : Array.from({ length: HISTORY_PLACEHOLDER_POINTS }, (_, i) => ({ point: i, value: totalPortfolioValue }))

  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
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
            Portfolio value history isn't tracked yet, so this shows a flat line at your current
            value (TODO: chart real history once snapshots are recorded).
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
            <Button
              variant="secondary"
              className="flex w-full items-center justify-center gap-2"
              onClick={handleAddFunds}
              disabled={pendingAction !== null}
            >
              <PlusCircle size={16} />
              {pendingAction === 'add-funds' ? 'Adding…' : 'Add Virtual Funds'}
            </Button>
            <Button
              variant="secondary"
              className="flex w-full items-center justify-center gap-2 text-danger hover:border-danger"
              onClick={handleResetPortfolio}
              disabled={pendingAction !== null}
            >
              <RotateCcw size={16} />
              {pendingAction === 'reset' ? 'Resetting…' : 'Reset Portfolio'}
            </Button>
          </div>
          {actionError && <p className="mt-3 text-xs text-danger">{actionError}</p>}
          <p className="mt-auto pt-4 text-[11px] text-text-muted">
            Buy/Sell open the trading terminal once you pick a market — order execution isn't
            built yet.
          </p>
        </Card>
      </div>

      {/* Market Overview */}
      <section className="mt-10">
        <h2 className="text-lg font-semibold text-text-primary">Market Overview</h2>
        <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
          {TRACKED_SYMBOLS.map((symbol) => {
            const coin = prices.find((price) => price.symbol === symbol)
            return <MarketCard key={symbol} coin={coin} loading={pricesLoading || !coin} />
          })}
        </div>
      </section>

      {/* My Watchlist */}
      <section className="mt-10">
        <h2 className="text-lg font-semibold text-text-primary">My Watchlist</h2>
        <Card className="mt-4 p-0">
          <WatchlistTable prices={prices} loading={pricesLoading} />
        </Card>
      </section>
    </div>
  )
}

function MiniStat({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="rounded-md border border-border bg-surface-alt px-3 py-2">
      <p className="text-[10px] uppercase tracking-wide text-text-muted">{label}</p>
      {value === null ? (
        <div className="mt-1.5 h-4 w-16 animate-pulse rounded bg-surface" />
      ) : (
        <p className="mt-1 font-mono text-sm text-text-primary">{value}</p>
      )}
    </div>
  )
}
