import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { doc, onSnapshot } from 'firebase/firestore'
import { Area, AreaChart, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, YAxis } from 'recharts'
import Card from '../components/Card'
import Button from '../components/Button'
import PageContainer from '../components/PageContainer'
import { useAuth } from '../context/AuthContext'
import { useMarketData } from '../context/MarketDataContext'
import { usePortfolioSnapshots } from '../hooks/usePortfolioSnapshots'
import { db } from '../lib/firebase'
import { formatUsd } from '../lib/constants'
import { summarizeHoldings } from '../lib/portfolioMath'
import type { HoldingsMap } from '../types'

interface AccountState {
  balance: number
  holdings: HoldingsMap
  totalRealizedPnl: number
}

// A deliberate, on-theme palette rather than recharts' defaults — gold for
// the largest/primary asset slot, a muted gray for Cash (it isn't "invested"),
// and a few complementary accents for the rest of the tracked assets.
const ASSET_COLORS: Record<string, string> = {
  BTC: '#FFD700',
  ETH: '#60A5FA',
  SOL: '#C084FC',
  XRP: '#20d58a',
  BNB: '#FB923C',
}
const CASH_COLOR = '#92989e'
const FALLBACK_ASSET_COLOR = '#FFD700'

const FLAT_LINE_POINTS = 12

export default function Portfolio() {
  const { user } = useAuth()
  const { prices } = useMarketData()
  const { snapshots } = usePortfolioSnapshots(user?.uid)

  const [account, setAccount] = useState<AccountState | null>(null)
  const [accountLoading, setAccountLoading] = useState(true)
  const [accountError, setAccountError] = useState<string | null>(null)

  useEffect(() => {
    if (!user) return
    if (!db) {
      setAccountError('Firebase is not configured yet — add your project keys to .env.')
      setAccountLoading(false)
      return
    }

    const unsubscribe = onSnapshot(
      doc(db, 'users', user.uid),
      (snapshot) => {
        const data = snapshot.data()
        setAccount({
          balance: typeof data?.balance === 'number' ? data.balance : 0,
          holdings: (data?.holdings as HoldingsMap | undefined) ?? {},
          // Missing on accounts that predate realized P&L tracking — 0 is the correct read, not a crash.
          totalRealizedPnl: typeof data?.totalRealizedPnl === 'number' ? data.totalRealizedPnl : 0,
        })
        setAccountError(null)
        setAccountLoading(false)
      },
      (err) => {
        // eslint-disable-next-line no-console
        console.error('[portfolio] account snapshot error', err)
        setAccountError('Could not load your portfolio — please try again shortly.')
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
          aria-label="Loading your portfolio"
        />
      </div>
    )
  }

  if (accountError || !account) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-16 text-center">
        <p className="text-danger">{accountError ?? 'Something went wrong loading your portfolio.'}</p>
      </div>
    )
  }

  const hasHoldings = Object.keys(account.holdings).length > 0

  if (!hasHoldings && snapshots.length === 0) {
    return (
      <PageContainer>
        <header>
          <h1 className="text-2xl font-semibold text-text-primary">Portfolio</h1>
          <p className="mt-1 text-sm text-text-muted">
            Allocation, performance, and value history for your account.
          </p>
        </header>
        <Card className="mt-8 flex flex-col items-center gap-3 py-16 text-center">
          <p className="max-w-sm text-text-muted">
            You haven't made any trades yet. Once you buy your first asset, your allocation,
            P&amp;L, and value history will show up here.
          </p>
          <Link to="/markets">
            <Button variant="primary">Explore Markets</Button>
          </Link>
        </Card>
      </PageContainer>
    )
  }

  const { rows, pending, holdingsValue, totalUnrealizedPnl, totalCostBasis } = summarizeHoldings(
    account.holdings,
    prices,
  )
  const totalPortfolioValue = account.balance + holdingsValue

  const allocationData = pending
    ? []
    : [
        { name: 'Cash', value: account.balance, color: CASH_COLOR },
        ...rows.map((row) => ({
          name: row.symbol,
          value: row.currentValue ?? 0,
          color: ASSET_COLORS[row.symbol] ?? FALLBACK_ASSET_COLOR,
        })),
      ].filter((slice) => slice.value > 0)

  const chartData =
    snapshots.length >= 2
      ? snapshots.map((point) => ({ point: point.id, value: point.totalValue }))
      : Array.from({ length: FLAT_LINE_POINTS }, (_, i) => ({ point: String(i), value: totalPortfolioValue }))

  return (
    <PageContainer>
      <header>
        <h1 className="text-2xl font-semibold text-text-primary">Portfolio</h1>
        <p className="mt-1 text-sm text-text-muted">
          Allocation, performance, and value history for your account.
        </p>
      </header>

      {/* Summary row */}
      <div className="mt-8 grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-4">
        <Card>
          <span className="text-xs uppercase tracking-wide text-text-muted">Total Portfolio Value</span>
          {pending ? (
            <div className="mt-2 h-8 w-32 animate-pulse rounded bg-surface-alt" />
          ) : (
            <p className="mt-2 font-mono text-2xl text-text-primary">{formatUsd(totalPortfolioValue)}</p>
          )}
        </Card>
        <Card>
          <span className="text-xs uppercase tracking-wide text-text-muted">Total Unrealized P&amp;L</span>
          {pending ? (
            <div className="mt-2 h-8 w-32 animate-pulse rounded bg-surface-alt" />
          ) : (
            <p className={`mt-2 font-mono text-2xl ${totalUnrealizedPnl >= 0 ? 'text-success' : 'text-danger'}`}>
              {totalUnrealizedPnl >= 0 ? '+' : ''}
              {formatUsd(totalUnrealizedPnl)}
            </p>
          )}
        </Card>
        <Card>
          <span className="text-xs uppercase tracking-wide text-text-muted">Total Realized P&amp;L</span>
          <p
            className={`mt-2 font-mono text-2xl ${
              account.totalRealizedPnl >= 0 ? 'text-success' : 'text-danger'
            }`}
          >
            {account.totalRealizedPnl >= 0 ? '+' : ''}
            {formatUsd(account.totalRealizedPnl)}
          </p>
        </Card>
        <Card>
          <span className="text-xs uppercase tracking-wide text-text-muted">Total Invested</span>
          <p className="mt-2 font-mono text-2xl text-text-primary">{formatUsd(totalCostBasis)}</p>
        </Card>
      </div>

      {/* Allocation + value history */}
      <div className="mt-8 grid gap-4 lg:grid-cols-2">
        <Card>
          <span className="text-xs uppercase tracking-wide text-text-muted">Allocation</span>
          {pending || allocationData.length === 0 ? (
            <div className="mt-4 flex h-56 items-center justify-center font-mono text-xs text-text-muted">
              {pending ? 'Loading…' : 'Nothing to allocate yet.'}
            </div>
          ) : (
            <div className="mt-4 flex flex-col items-center gap-4 sm:flex-row">
              <div className="h-56 w-56 flex-none">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={allocationData}
                      dataKey="value"
                      nameKey="name"
                      innerRadius={55}
                      outerRadius={85}
                      paddingAngle={2}
                      strokeWidth={0}
                      isAnimationActive={false}
                    >
                      {allocationData.map((slice) => (
                        <Cell key={slice.name} fill={slice.color} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{
                        background: 'var(--color-surface)',
                        border: '1px solid var(--color-border)',
                        borderRadius: 8,
                        fontSize: 12,
                        color: 'var(--color-text-primary)',
                      }}
                      formatter={(value) => formatUsd(Number(value))}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <ul className="w-full flex-1 space-y-2 text-sm">
                {allocationData.map((slice) => (
                  <li key={slice.name} className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-2 text-text-muted">
                      <span className="h-2.5 w-2.5 flex-none rounded-full" style={{ backgroundColor: slice.color }} />
                      {slice.name}
                    </span>
                    <span className="font-mono text-text-primary">
                      {formatUsd(slice.value)} ·{' '}
                      {totalPortfolioValue > 0 ? ((slice.value / totalPortfolioValue) * 100).toFixed(1) : '0.0'}%
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>

        <Card>
          <span className="text-xs uppercase tracking-wide text-text-muted">Portfolio Value Over Time</span>
          <div className="mt-4 h-56">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id="portfolioValueHistory" x1="0" y1="0" x2="0" y2="1">
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
                  fill="url(#portfolioValueHistory)"
                  isAnimationActive={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <p className="mt-2 text-[11px] text-text-muted">
            {snapshots.length >= 2
              ? 'Real portfolio value recorded at each of your trades.'
              : "Not enough trade history yet for a real chart, so this shows a flat line at your current value."}
          </p>
        </Card>
      </div>

      {/* Per-holding performance */}
      <section className="mt-10">
        <h2 className="text-lg font-semibold text-text-primary">Holdings</h2>
        {rows.length === 0 ? (
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
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-text-muted">
                  <th className="px-4 py-3 font-medium">Symbol</th>
                  <th className="px-4 py-3 font-medium">Qty</th>
                  <th className="px-4 py-3 font-medium">Avg Buy Price</th>
                  <th className="px-4 py-3 font-medium">Current Price</th>
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
                    {row.priceKnown ? (
                      <>
                        <td className="px-4 py-3 font-mono text-text-primary">{formatUsd(row.currentPrice)}</td>
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
    </PageContainer>
  )
}
