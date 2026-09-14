import { useEffect, useState } from 'react'
import { collection, doc, limit, onSnapshot, orderBy, query } from 'firebase/firestore'
import { ArrowDownToLine, ArrowUpFromLine, Wallet as WalletIcon } from 'lucide-react'
import Card from '../components/Card'
import Button from '../components/Button'
import MiniStat from '../components/MiniStat'
import PageContainer from '../components/PageContainer'
import BalanceRequestPanel from '../components/BalanceRequestPanel'
import DepositModal from '../components/DepositModal'
import WithdrawModal from '../components/WithdrawModal'
import { useAuth } from '../context/AuthContext'
import { useMarketData } from '../context/MarketDataContext'
import { db } from '../lib/firebase'
import { formatUsd } from '../lib/constants'
import type { HoldingsMap } from '../types'

interface TransactionRow {
  id: string
  type: 'buy' | 'sell'
  symbol: string
  qty: number
  price: number
  total: number
  timestamp: Date | null
}

const TRANSACTION_HISTORY_LIMIT = 50

export default function Wallet() {
  const { user } = useAuth()
  const { prices } = useMarketData()

  const [balance, setBalance] = useState(0)
  const [holdings, setHoldings] = useState<HoldingsMap>({})
  const [email, setEmail] = useState('')
  const [pendingWithdrawalTotal, setPendingWithdrawalTotal] = useState(0)
  const [accountLoading, setAccountLoading] = useState(true)

  const [transactions, setTransactions] = useState<TransactionRow[]>([])
  const [transactionsLoading, setTransactionsLoading] = useState(true)

  const [depositOpen, setDepositOpen] = useState(false)
  const [withdrawOpen, setWithdrawOpen] = useState(false)

  useEffect(() => {
    if (!user || !db) {
      setAccountLoading(false)
      return
    }
    const unsubscribe = onSnapshot(doc(db, 'users', user.uid), (snapshot) => {
      const data = snapshot.data()
      setBalance(typeof data?.balance === 'number' ? data.balance : 0)
      setHoldings((data?.holdings as HoldingsMap | undefined) ?? {})
      setEmail(typeof data?.email === 'string' ? data.email : user.email ?? '')
      setPendingWithdrawalTotal(typeof data?.pendingWithdrawalTotal === 'number' ? data.pendingWithdrawalTotal : 0)
      setAccountLoading(false)
    })
    return unsubscribe
  }, [user])

  useEffect(() => {
    if (!user || !db) {
      setTransactionsLoading(false)
      return
    }
    const transactionsQuery = query(
      collection(db, 'users', user.uid, 'transactions'),
      orderBy('timestamp', 'desc'),
      limit(TRANSACTION_HISTORY_LIMIT),
    )
    const unsubscribe = onSnapshot(
      transactionsQuery,
      (snapshot) => {
        setTransactions(
          snapshot.docs.map((docSnapshot) => {
            const data = docSnapshot.data()
            const timestamp = data.timestamp
            return {
              id: docSnapshot.id,
              type: data.type === 'sell' ? 'sell' : 'buy',
              symbol: String(data.symbol ?? ''),
              qty: typeof data.qty === 'number' ? data.qty : 0,
              price: typeof data.price === 'number' ? data.price : 0,
              total: typeof data.total === 'number' ? data.total : 0,
              timestamp:
                timestamp && typeof timestamp.toDate === 'function' ? timestamp.toDate() : null,
            }
          }),
        )
        setTransactionsLoading(false)
      },
      () => setTransactionsLoading(false),
    )
    return unsubscribe
  }, [user])

  if (accountLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div
          className="h-8 w-8 animate-spin rounded-full border-2 border-border border-t-accent-gold"
          role="status"
          aria-label="Loading your wallet"
        />
      </div>
    )
  }

  const holdingRows = Object.entries(holdings).map(([symbol, holding]) => {
    const coin = prices.find((price) => price.symbol === symbol)
    const priceKnown = Boolean(coin && coin.price > 0)
    const value = priceKnown ? holding.qty * (coin?.price ?? 0) : null
    return { symbol, qty: holding.qty, value }
  })

  const knownHoldingsValue = holdingRows.reduce((sum, row) => sum + (row.value ?? 0), 0)
  const anyValuePending = holdingRows.some((row) => row.value === null)
  const totalPortfolioValue = balance + knownHoldingsValue
  const availableToWithdraw = Math.max(0, balance - pendingWithdrawalTotal)

  return (
    <PageContainer>
      <header>
        <h1 className="text-2xl font-semibold text-text-primary">Wallet</h1>
        <p className="mt-1 text-sm text-text-muted">Your virtual cash, holdings, and trade history.</p>
      </header>

      {/* Wallet balance hero — the page's main focal point, matching a
          crypto-exchange-style wallet: one big balance figure, its
          breakdown, and Deposit/Withdraw as the two primary actions. */}
      <Card className="mt-8 overflow-hidden border-accent-gold/20 bg-gradient-to-br from-surface to-surface-alt p-6 sm:p-8">
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div>
            <span className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-text-muted">
              <WalletIcon size={14} className="text-accent-gold" /> Available Cash
            </span>
            <p className="mt-2 font-mono text-4xl font-semibold text-text-primary sm:text-5xl">
              {formatUsd(balance)}
            </p>
          </div>

          <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
            <Button
              className="flex w-full items-center justify-center gap-2 px-5 sm:w-auto"
              onClick={() => setDepositOpen(true)}
            >
              <ArrowDownToLine size={16} /> Deposit
            </Button>
            <Button
              variant="secondary"
              className="flex w-full items-center justify-center gap-2 px-5 sm:w-auto"
              onClick={() => setWithdrawOpen(true)}
            >
              <ArrowUpFromLine size={16} /> Withdraw
            </Button>
          </div>
        </div>

        <div className="mt-6 grid grid-cols-1 gap-3 border-t border-border pt-5 sm:grid-cols-3">
          <MiniStat
            label="Total Portfolio Value"
            value={anyValuePending ? null : formatUsd(totalPortfolioValue)}
          />
          <MiniStat label="Holdings Value" value={anyValuePending ? null : formatUsd(knownHoldingsValue)} />
          <MiniStat label="Available to Withdraw" value={formatUsd(availableToWithdraw)} />
        </div>
      </Card>

      <DepositModal open={depositOpen} onClose={() => setDepositOpen(false)} uid={user?.uid ?? ''} email={email} />
      <WithdrawModal
        open={withdrawOpen}
        onClose={() => setWithdrawOpen(false)}
        uid={user?.uid ?? ''}
        email={email}
        balance={balance}
        pendingWithdrawalTotal={pendingWithdrawalTotal}
      />

      <section className="mt-10">
        <h2 className="text-lg font-semibold text-text-primary">Holdings</h2>
        {holdingRows.length === 0 ? (
          <Card className="mt-4 py-10 text-center text-sm text-text-muted">
            You don't hold any assets yet — head to Markets to place your first trade.
          </Card>
        ) : (
          <Card className="mt-4 overflow-x-auto p-0">
            <table className="w-full min-w-[480px] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-text-muted">
                  <th className="px-4 py-3 font-medium">Symbol</th>
                  <th className="px-4 py-3 font-medium">Qty</th>
                  <th className="px-4 py-3 font-medium text-right">Current Value</th>
                </tr>
              </thead>
              <tbody>
                {holdingRows.map((row) => (
                  <tr key={row.symbol} className="border-b border-border last:border-0">
                    <td className="px-4 py-3 font-mono font-semibold text-text-primary">{row.symbol}</td>
                    <td className="px-4 py-3 font-mono text-text-primary">{row.qty}</td>
                    <td className="px-4 py-3 text-right font-mono text-text-primary">
                      {row.value !== null ? formatUsd(row.value) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}
      </section>

      {user && <BalanceRequestPanel uid={user.uid} />}

      <section className="mt-10">
        <h2 className="text-lg font-semibold text-text-primary">Transaction History</h2>
        {transactionsLoading ? (
          <Card className="mt-4 animate-pulse py-10 text-center text-sm text-text-muted">Loading…</Card>
        ) : transactions.length === 0 ? (
          <Card className="mt-4 py-10 text-center text-sm text-text-muted">
            No trades yet — head to Markets to place your first trade.
          </Card>
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
    </PageContainer>
  )
}
