import { useEffect, useState } from 'react'
import { collection, doc, increment, limit, onSnapshot, orderBy, query, updateDoc } from 'firebase/firestore'
import { PlusCircle, RotateCcw } from 'lucide-react'
import Card from '../components/Card'
import Button from '../components/Button'
import MiniStat from '../components/MiniStat'
import PageContainer from '../components/PageContainer'
import { useAuth } from '../context/AuthContext'
import { useMarketData } from '../context/MarketDataContext'
import { db } from '../lib/firebase'
import { ADD_VIRTUAL_FUNDS_AMOUNT, STARTING_VIRTUAL_BALANCE, formatUsd } from '../lib/constants'
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

type PendingAction = 'add-funds' | 'reset' | null

const TRANSACTION_HISTORY_LIMIT = 50

export default function Wallet() {
  const { user } = useAuth()
  const { prices } = useMarketData()

  const [balance, setBalance] = useState(0)
  const [holdings, setHoldings] = useState<HoldingsMap>({})
  const [accountLoading, setAccountLoading] = useState(true)

  const [transactions, setTransactions] = useState<TransactionRow[]>([])
  const [transactionsLoading, setTransactionsLoading] = useState(true)

  const [pendingAction, setPendingAction] = useState<PendingAction>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  useEffect(() => {
    if (!user || !db) {
      setAccountLoading(false)
      return
    }
    const unsubscribe = onSnapshot(doc(db, 'users', user.uid), (snapshot) => {
      const data = snapshot.data()
      setBalance(typeof data?.balance === 'number' ? data.balance : 0)
      setHoldings((data?.holdings as HoldingsMap | undefined) ?? {})
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
      console.error('[wallet] add funds failed', err)
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
      console.error('[wallet] reset portfolio failed', err)
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

  return (
    <PageContainer>
      <header>
        <h1 className="text-2xl font-semibold text-text-primary">Wallet</h1>
        <p className="mt-1 text-sm text-text-muted">Your virtual cash, holdings, and trade history.</p>
      </header>

      <div className="mt-8 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <span className="text-xs uppercase tracking-wide text-text-muted">Available Cash</span>
          <p className="mt-2 font-mono text-4xl text-text-primary">{formatUsd(balance)}</p>

          <div className="mt-5 grid grid-cols-2 gap-3 border-t border-border pt-4">
            <MiniStat
              label="Total Portfolio Value"
              value={anyValuePending ? null : formatUsd(totalPortfolioValue)}
            />
            <MiniStat label="Holdings Value" value={anyValuePending ? null : formatUsd(knownHoldingsValue)} />
          </div>
        </Card>

        <Card className="flex flex-col">
          <span className="text-xs uppercase tracking-wide text-text-muted">Manage Funds</span>
          <div className="mt-4 flex flex-col gap-3">
            <Button
              variant="secondary"
              className="flex items-center justify-center gap-2"
              onClick={handleAddFunds}
              disabled={pendingAction !== null}
            >
              <PlusCircle size={16} />
              {pendingAction === 'add-funds' ? 'Adding…' : 'Add Virtual Funds'}
            </Button>
            <Button
              variant="secondary"
              className="flex items-center justify-center gap-2 text-danger hover:border-danger"
              onClick={handleResetPortfolio}
              disabled={pendingAction !== null}
            >
              <RotateCcw size={16} />
              {pendingAction === 'reset' ? 'Resetting…' : 'Reset Portfolio'}
            </Button>
          </div>
          {actionError && <p className="mt-3 text-xs text-danger">{actionError}</p>}
        </Card>
      </div>

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
