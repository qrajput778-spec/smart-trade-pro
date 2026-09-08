import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { doc, onSnapshot } from 'firebase/firestore'
import { Area, AreaChart, ResponsiveContainer, YAxis } from 'recharts'
import { ArrowDownCircle, ArrowUpCircle, CheckCircle2 } from 'lucide-react'
import Card from '../components/Card'
import Button from '../components/Button'
import Badge from '../components/Badge'
import PageContainer from '../components/PageContainer'
import { useAuth } from '../context/AuthContext'
import { useMarketData } from '../context/MarketDataContext'
import { db } from '../lib/firebase'
import { formatUsd } from '../lib/constants'
import { executeBuyOrder, executeSellOrder, roundQty, roundUsd, type OrderResult, type OrderSide } from '../lib/trading'
import type { HoldingsMap } from '../types'

interface PricePoint {
  time: number
  price: number
}

type InputMode = 'usd' | 'qty'

const HISTORY_LIMIT = 30

export default function Trade() {
  const params = useParams<{ symbol: string }>()
  const symbol = (params.symbol ?? '').toUpperCase()

  const { user } = useAuth()
  const { prices, loading: pricesLoading } = useMarketData()
  const coin = prices.find((price) => price.symbol === symbol)
  const priceKnown = Boolean(coin && coin.price > 0)
  const price = coin?.price ?? 0

  const [history, setHistory] = useState<PricePoint[]>([])
  useEffect(() => {
    if (priceKnown) {
      setHistory((prev) => [...prev, { time: Date.now(), price }].slice(-HISTORY_LIMIT))
    }
    // Only the price value matters for sampling — re-running on every prices
    // array identity change would sample far more often than prices actually change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [price])

  // Reset the session chart when navigating between symbols.
  useEffect(() => {
    setHistory([])
  }, [symbol])

  const [holdings, setHoldings] = useState<HoldingsMap>({})
  const [balance, setBalance] = useState(0)
  const [accountLoading, setAccountLoading] = useState(true)

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

  const heldQty = holdings[symbol]?.qty ?? 0

  const [side, setSide] = useState<OrderSide>('buy')
  const [inputMode, setInputMode] = useState<InputMode>('usd')
  const [amountInput, setAmountInput] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [orderError, setOrderError] = useState<string | null>(null)
  const [successResult, setSuccessResult] = useState<(OrderResult & { side: OrderSide }) | null>(null)

  const rawAmount = Number.parseFloat(amountInput) || 0
  const usdAmount = inputMode === 'usd' ? rawAmount : priceKnown ? rawAmount * price : 0
  const qty = inputMode === 'qty' ? rawAmount : priceKnown ? rawAmount / price : 0
  const roundedQty = roundQty(qty)
  const total = roundUsd(roundedQty * price)

  function handleModeChange(nextMode: InputMode) {
    if (nextMode === inputMode) return
    if (priceKnown && rawAmount > 0) {
      const converted = nextMode === 'qty' ? rawAmount / price : rawAmount * price
      setAmountInput(String(Number(converted.toFixed(nextMode === 'qty' ? 6 : 2))))
    } else {
      setAmountInput('')
    }
    setInputMode(nextMode)
  }

  function handleSideChange(nextSide: OrderSide) {
    setSide(nextSide)
    setOrderError(null)
    setSuccessResult(null)
  }

  let disabledReason: string | null = null
  if (accountLoading) disabledReason = 'Loading your account…'
  else if (!priceKnown) disabledReason = 'Waiting for a live price…'
  else if (roundedQty <= 0) disabledReason = 'Enter an amount to trade.'
  else if (side === 'buy' && total > balance) disabledReason = 'Insufficient virtual cash for this order.'
  else if (side === 'sell' && roundedQty > heldQty)
    disabledReason = `You only hold ${heldQty} ${symbol} — can't sell more than that.`

  async function handleExecute() {
    if (!user || disabledReason) return
    setSubmitting(true)
    setOrderError(null)
    setSuccessResult(null)
    try {
      // Current live prices for every tracked symbol, not just this one —
      // executeBuyOrder/executeSellOrder need it to value the *whole*
      // holdings map for the portfolio snapshot they write, not just the
      // symbol being traded here.
      const priceLookup = Object.fromEntries(prices.map((coinPrice) => [coinPrice.symbol, coinPrice.price]))
      const result =
        side === 'buy'
          ? await executeBuyOrder(user.uid, symbol, roundedQty, price, priceLookup)
          : await executeSellOrder(user.uid, symbol, roundedQty, price, priceLookup)
      setSuccessResult({ ...result, side })
      setAmountInput('')
    } catch (err) {
      setOrderError(err instanceof Error ? err.message : 'Something went wrong placing this order.')
    } finally {
      setSubmitting(false)
    }
  }

  const isUp = (coin?.change24h ?? 0) >= 0

  return (
    <PageContainer>
      <header>
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold text-text-primary">{symbol || 'Unknown symbol'}</h1>
          <span className="text-text-muted">{coin?.name ?? (pricesLoading ? 'Loading…' : 'Not tracked')}</span>
        </div>
        <div className="mt-2 flex items-baseline gap-3">
          <span className="font-mono text-3xl text-text-primary">{priceKnown ? formatUsd(price) : '—'}</span>
          {coin && (
            <Badge tone={isUp ? 'success' : 'danger'}>
              {isUp ? '+' : ''}
              {coin.change24h.toFixed(2)}% (24h)
            </Badge>
          )}
        </div>
      </header>

      <div className="mt-8 grid gap-6 lg:grid-cols-3">
        {/* Chart */}
        <Card className="lg:col-span-2">
          <p className="text-xs uppercase tracking-wide text-text-muted">Price (this session)</p>
          <div className="mt-4 h-64">
            {history.length > 1 ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={history} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
                  <defs>
                    <linearGradient id="tradeSparkline" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#FFD700" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="#FFD700" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <YAxis hide domain={['dataMin', 'dataMax']} />
                  <Area
                    type="monotone"
                    dataKey="price"
                    stroke="#FFD700"
                    strokeWidth={2}
                    fill="url(#tradeSparkline)"
                    isAnimationActive={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-full items-center justify-center font-mono text-xs text-text-muted">
                Gathering live price history…
              </div>
            )}
          </div>
          <p className="mt-2 text-[11px] text-text-muted">
            Chart reflects prices sampled since you opened this page (updates every 30s) — not a
            full historical feed.
          </p>
        </Card>

        {/* Order panel */}
        <Card className="flex flex-col">
          <div className="flex rounded-md border border-border p-1">
            <button
              type="button"
              onClick={() => handleSideChange('buy')}
              className={`flex-1 rounded py-2 text-sm font-semibold transition-colors ${
                side === 'buy' ? 'bg-success/10 text-success' : 'text-text-muted hover:text-text-primary'
              }`}
            >
              Buy
            </button>
            <button
              type="button"
              onClick={() => handleSideChange('sell')}
              className={`flex-1 rounded py-2 text-sm font-semibold transition-colors ${
                side === 'sell' ? 'bg-danger/10 text-danger' : 'text-text-muted hover:text-text-primary'
              }`}
            >
              Sell
            </button>
          </div>

          <div className="mt-4">
            <div className="flex items-center justify-between">
              <label htmlFor="trade-amount" className="text-xs uppercase tracking-wide text-text-muted">
                Amount
              </label>
              <div className="flex overflow-hidden rounded-md border border-border text-xs">
                <button
                  type="button"
                  onClick={() => handleModeChange('usd')}
                  className={`px-2 py-1 font-mono ${
                    inputMode === 'usd' ? 'bg-accent-gold-soft text-accent-gold' : 'text-text-muted'
                  }`}
                >
                  USD
                </button>
                <button
                  type="button"
                  onClick={() => handleModeChange('qty')}
                  className={`px-2 py-1 font-mono ${
                    inputMode === 'qty' ? 'bg-accent-gold-soft text-accent-gold' : 'text-text-muted'
                  }`}
                >
                  {symbol || 'QTY'}
                </button>
              </div>
            </div>
            <input
              id="trade-amount"
              type="number"
              inputMode="decimal"
              min="0"
              step="any"
              value={amountInput}
              onChange={(event) => setAmountInput(event.target.value)}
              placeholder="0.00"
              className="mt-2 w-full rounded-md border border-border bg-surface-alt px-3 py-2 font-mono text-lg text-text-primary focus:outline-none focus:ring-1 focus:border-accent-gold focus:ring-accent-gold"
            />
            <p className="mt-1 text-xs text-text-muted">
              {inputMode === 'usd'
                ? `≈ ${roundedQty} ${symbol || ''}`
                : `≈ ${formatUsd(usdAmount)}`}
            </p>
          </div>

          <div className="mt-4 space-y-2 rounded-md border border-border bg-surface-alt p-3 text-sm">
            <div className="flex justify-between">
              <span className="text-text-muted">Est. quantity</span>
              <span className="font-mono text-text-primary">
                {roundedQty} {symbol}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-text-muted">Est. total</span>
              <span className="font-mono text-text-primary">{formatUsd(total)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-text-muted">Fee</span>
              <span className="font-mono text-success">0% (simulated)</span>
            </div>
            <div className="flex justify-between border-t border-border pt-2">
              <span className="text-text-muted">{side === 'sell' ? 'You hold' : 'Available cash'}</span>
              <span className="font-mono text-text-primary">
                {side === 'sell' ? `${heldQty} ${symbol}` : formatUsd(balance)}
              </span>
            </div>
          </div>

          {orderError && <p className="mt-3 text-xs text-danger">{orderError}</p>}
          {!orderError && disabledReason && (
            <p className="mt-3 text-xs text-text-muted">{disabledReason}</p>
          )}

          <Button
            variant="primary"
            className="mt-4 flex w-full items-center justify-center gap-2"
            disabled={Boolean(disabledReason) || submitting}
            onClick={handleExecute}
          >
            {side === 'buy' ? <ArrowUpCircle size={16} /> : <ArrowDownCircle size={16} />}
            {submitting ? 'Placing order…' : `${side === 'buy' ? 'Buy' : 'Sell'} ${symbol}`}
          </Button>
        </Card>
      </div>

      {successResult && (
        <div className="mt-6 flex items-start gap-2 rounded-md border border-success/30 bg-success/10 px-4 py-3 text-sm text-success">
          <CheckCircle2 size={18} className="mt-0.5 flex-none" />
          <span>
            Order filled: {successResult.side === 'buy' ? 'Bought' : 'Sold'} {successResult.qty}{' '}
            {successResult.symbol} @ {formatUsd(successResult.price)} — total{' '}
            {formatUsd(successResult.total)}.
            {typeof successResult.realizedPnl === 'number' && (
              <>
                {' '}
                Realized P&amp;L:{' '}
                <span className={successResult.realizedPnl >= 0 ? 'text-success' : 'text-danger'}>
                  {successResult.realizedPnl >= 0 ? '+' : ''}
                  {formatUsd(successResult.realizedPnl)}
                </span>
                .
              </>
            )}
          </span>
        </div>
      )}
    </PageContainer>
  )
}
