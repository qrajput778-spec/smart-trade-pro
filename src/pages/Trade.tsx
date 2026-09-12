import { useEffect, useState } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router-dom'
import { doc, onSnapshot } from 'firebase/firestore'
import { CheckCircle2, History, Inbox, TrendingDown, TrendingUp } from 'lucide-react'
import Card from '../components/Card'
import Button from '../components/Button'
import Badge from '../components/Badge'
import TradingChartWidget from '../components/TradingChartWidget'
import { useAuth } from '../context/AuthContext'
import { useMarketData } from '../context/MarketDataContext'
import { useTimedTrades } from '../context/TimedTradesContext'
import { db } from '../lib/firebase'
import { DEFAULT_TRADE_SYMBOL, formatUsd, isTrackedSymbol } from '../lib/constants'
import { roundQty, roundUsd } from '../lib/trading'
import { DEFAULT_TIMED_TRADE_DURATION, TIMED_TRADE_DURATIONS, openTimedTrade } from '../lib/timedTrading'
import type { PositionType, TimedTradeDuration } from '../types'

type InputMode = 'usd' | 'qty'
type OrderSide = 'buy' | 'sell'

interface OpenedTradeSummary {
  direction: PositionType
  investedAmount: number
  duration: TimedTradeDuration
  scheduledCloseAt: Date
}

function formatCountdown(remainingMs: number): string {
  const totalSeconds = Math.max(0, Math.ceil(remainingMs / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

// Chart on the left, a fixed-width order/trades sidebar on the right — a
// real exchange terminal proportion (chart the dominant visual element),
// not an even split. Below `lg` the two stack vertically instead. Written
// as full literal class strings (not built at runtime) so Tailwind's
// content scanner can actually find and generate them.
const CHART_HEIGHT = 'h-[72vh] min-h-[480px] lg:h-[calc(100vh-208px)]'
const SIDEBAR_MAX_HEIGHT = 'lg:max-h-[calc(100vh-208px)]'

export default function Trade() {
  const params = useParams<{ symbol: string }>()
  const symbol = (params.symbol ?? '').toUpperCase()
  const navigate = useNavigate()

  const { user } = useAuth()
  const { prices, loading: pricesLoading } = useMarketData()
  const { openTrades, allTrades } = useTimedTrades()
  const coin = prices.find((price) => price.symbol === symbol)
  const priceKnown = Boolean(coin && coin.price > 0)
  const price = coin?.price ?? 0

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
      setAccountLoading(false)
    })
    return unsubscribe
  }, [user])

  // A per-second ticker purely for the countdown display below — the
  // actual settlement decision (and its safety against duplicate/racing
  // settlement) lives entirely in TimedTradesContext's background sweep,
  // which runs independently of whether this page is even mounted.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(interval)
  }, [])

  const [side, setSide] = useState<OrderSide>('buy')
  const [duration, setDuration] = useState<TimedTradeDuration>(DEFAULT_TIMED_TRADE_DURATION)
  const [inputMode, setInputMode] = useState<InputMode>('usd')
  const [amountInput, setAmountInput] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [orderError, setOrderError] = useState<string | null>(null)
  const [successResult, setSuccessResult] = useState<OpenedTradeSummary | null>(null)

  const rawAmount = Number.parseFloat(amountInput) || 0
  const usdAmount = inputMode === 'usd' ? rawAmount : priceKnown ? rawAmount * price : 0
  const qty = inputMode === 'qty' ? rawAmount : priceKnown ? rawAmount / price : 0
  const roundedQty = roundQty(qty)
  const total = roundUsd(inputMode === 'usd' ? rawAmount : roundedQty * price)

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
  else if (!(total > 0)) disabledReason = 'Enter an amount to trade.'
  else if (total > balance) disabledReason = 'Insufficient virtual cash for this trade.'

  async function handleExecute() {
    if (!user || disabledReason) return
    setSubmitting(true)
    setOrderError(null)
    setSuccessResult(null)
    try {
      const direction: PositionType = side === 'buy' ? 'LONG' : 'SHORT'
      const result = await openTimedTrade(user.uid, symbol, direction, total, price, duration)
      setSuccessResult({ direction, investedAmount: total, duration, scheduledCloseAt: result.scheduledCloseAt })
      setAmountInput('')
    } catch (err) {
      setOrderError(err instanceof Error ? err.message : 'Something went wrong placing this trade.')
    } finally {
      setSubmitting(false)
    }
  }

  const isUp = (coin?.change24h ?? 0) >= 0

  // An unrecognized symbol (a stale link, a typo, a coin that's since been
  // dropped from TRACKED_SYMBOLS) — bounce to the default market instead of
  // rendering a page that can never show a real price. Checked against
  // TRACKED_SYMBOLS directly rather than waiting on `prices` to load, so a
  // perfectly valid symbol never gets misjudged as "invalid" just because
  // the first market-data poll hasn't resolved yet. `replace` (not a
  // regular navigate) keeps this from ever being a loop: DEFAULT_TRADE_SYMBOL
  // is itself always tracked, so the redirected render passes this same
  // check and stops here.
  if (!isTrackedSymbol(symbol)) {
    return <Navigate to={`/trade/${DEFAULT_TRADE_SYMBOL}`} replace />
  }

  // This user's own open timed trades (see TimedTradesContext — owner-scoped,
  // updated live, and settled automatically in the background regardless of
  // which page is open). The currently-viewed market sorts first and is
  // highlighted; every other open trade still shows below it.
  const sortedOpenTrades = [...openTrades].sort((a, b) => (a.symbol === symbol ? -1 : b.symbol === symbol ? 1 : 0))
  const closedTrades = allTrades.filter((trade) => trade.status === 'CLOSED')

  return (
    <div className="mx-auto flex w-full max-w-[1920px] flex-col px-4 py-4 lg:px-6">
      {/* Compact one-line header — symbol, name, live price, 24h change. */}
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1 pb-3">
        <h1 className="text-lg font-semibold text-text-primary">{symbol || 'Unknown symbol'}/USDT</h1>
        <span className="text-xs text-text-muted">{coin?.name ?? (pricesLoading ? 'Loading…' : 'Not tracked')}</span>
        <span className="font-mono text-xl text-text-primary">{priceKnown ? formatUsd(price) : '—'}</span>
        {coin && (
          <Badge tone={isUp ? 'success' : 'danger'}>
            {isUp ? '+' : ''}
            {coin.change24h.toFixed(2)}% (24h)
          </Badge>
        )}
      </header>

      <div className="grid flex-1 gap-4 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
        {/* Chart — the dominant visual element, stretched to fill the terminal's height. */}
        <div className={CHART_HEIGHT}>
          <TradingChartWidget symbol={symbol} onSymbolChange={(nextSymbol) => navigate(`/trade/${nextSymbol}`)} />
        </div>

        {/* Right sidebar — order form, open trades, order history. Fixed,
            narrow width; scrolls internally so it never forces the page
            taller than the chart next to it. */}
        <div className={`flex flex-col gap-3 ${SIDEBAR_MAX_HEIGHT} lg:overflow-y-auto lg:pr-0.5`}>
          <Card className="flex flex-col p-3">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-text-primary">Place Order</h2>

            <div className="mt-2 flex rounded-md border border-border p-0.5">
              <button
                type="button"
                onClick={() => handleSideChange('buy')}
                className={`flex-1 rounded py-1.5 text-xs font-semibold transition-colors ${
                  side === 'buy' ? 'bg-success/10 text-success' : 'text-text-muted hover:text-text-primary'
                }`}
              >
                Buy / Long
              </button>
              <button
                type="button"
                onClick={() => handleSideChange('sell')}
                className={`flex-1 rounded py-1.5 text-xs font-semibold transition-colors ${
                  side === 'sell' ? 'bg-danger/10 text-danger' : 'text-text-muted hover:text-text-primary'
                }`}
              >
                Sell / Short
              </button>
            </div>

            <div className="mt-2 flex items-center justify-between text-[11px]">
              <span className="text-text-muted">Market</span>
              <span className={`flex items-center gap-1 font-medium ${priceKnown ? 'text-success' : 'text-text-muted'}`}>
                <span className={`h-1.5 w-1.5 rounded-full ${priceKnown ? 'bg-success' : 'bg-text-muted'}`} />
                {priceKnown ? 'Open' : 'Waiting…'}
              </span>
            </div>

            <div className="mt-2">
              <label htmlFor="trade-duration" className="text-[11px] uppercase tracking-wide text-text-muted">
                Duration
              </label>
              <select
                id="trade-duration"
                value={duration}
                onChange={(event) => setDuration(event.target.value as TimedTradeDuration)}
                className="mt-1 w-full appearance-none rounded-md border border-border bg-surface-alt px-2.5 py-1.5 text-xs font-medium text-text-primary focus:outline-none focus:border-accent-gold focus:ring-1 focus:ring-accent-gold"
              >
                {TIMED_TRADE_DURATIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="mt-2">
              <div className="flex items-center justify-between">
                <label htmlFor="trade-amount" className="text-[11px] uppercase tracking-wide text-text-muted">
                  Amount
                </label>
                <div className="flex overflow-hidden rounded-md border border-border text-[10px]">
                  <button
                    type="button"
                    onClick={() => handleModeChange('usd')}
                    className={`px-1.5 py-0.5 font-mono ${
                      inputMode === 'usd' ? 'bg-accent-gold-soft text-accent-gold' : 'text-text-muted'
                    }`}
                  >
                    USD
                  </button>
                  <button
                    type="button"
                    onClick={() => handleModeChange('qty')}
                    className={`px-1.5 py-0.5 font-mono ${
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
                className="mt-1 w-full rounded-md border border-border bg-surface-alt px-2.5 py-1.5 font-mono text-sm text-text-primary focus:outline-none focus:ring-1 focus:border-accent-gold focus:ring-accent-gold"
              />
              <p className="mt-0.5 text-[10px] text-text-muted">
                {inputMode === 'usd' ? `≈ ${roundedQty} ${symbol || ''}` : `≈ ${formatUsd(usdAmount)}`}
              </p>
            </div>

            <div className="mt-2 space-y-1 rounded-md border border-border bg-surface-alt p-2 text-[11px]">
              <div className="flex justify-between">
                <span className="text-text-muted">Total {symbol}</span>
                <span className="font-mono text-text-primary">{roundedQty}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-text-muted">Invested</span>
                <span className="font-mono text-text-primary">{formatUsd(total)}</span>
              </div>
              <div className="flex justify-between border-t border-border pt-1">
                <span className="text-text-muted">Available</span>
                <span className="font-mono text-text-primary">{formatUsd(balance)}</span>
              </div>
            </div>

            {orderError && <p className="mt-2 text-[11px] text-danger">{orderError}</p>}
            {!orderError && disabledReason && <p className="mt-2 text-[11px] text-text-muted">{disabledReason}</p>}

            <Button
              variant="primary"
              className="mt-2.5 flex w-full items-center justify-center gap-1.5 py-2 text-sm"
              disabled={Boolean(disabledReason) || submitting}
              onClick={handleExecute}
            >
              {side === 'buy' ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
              {submitting ? 'Placing…' : `${side === 'buy' ? 'Buy / Long' : 'Sell / Short'} ${symbol}`}
            </Button>

            {successResult && (
              <div className="mt-2 flex items-start gap-1.5 rounded-md border border-success/30 bg-success/10 px-2 py-1.5 text-[11px] text-success">
                <CheckCircle2 size={12} className="mt-0.5 flex-none" />
                <span>
                  {successResult.direction === 'LONG' ? 'Long' : 'Short'} opened — {formatUsd(successResult.investedAmount)} invested.
                </span>
              </div>
            )}
          </Card>

          {/* Open Trades — compact cards, own internal scroll so a lot of
              open trades never pushes the order form or history out of view. */}
          <Card className="flex flex-col p-3">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-text-primary">Open Trades</h2>
              {sortedOpenTrades.length > 0 && <Badge tone="gold">{sortedOpenTrades.length}</Badge>}
            </div>

            {sortedOpenTrades.length === 0 ? (
              <div className="mt-2 flex flex-col items-center gap-1 rounded-md border border-dashed border-border py-3 text-center">
                <Inbox size={14} className="text-text-muted" />
                <p className="text-[11px] text-text-muted">No open trades</p>
              </div>
            ) : (
              <div className="mt-2 max-h-72 space-y-2 overflow-y-auto pr-0.5">
                {sortedOpenTrades.map((trade) => {
                  const isSelected = trade.symbol === symbol
                  const isShort = trade.direction === 'SHORT'
                  const coinPrice = prices.find((p) => p.symbol === trade.symbol)?.price ?? 0
                  const priceIsKnown = coinPrice > 0
                  // Fixed-payout preview: "if this settled right now" is
                  // always won/lost for the FULL invested amount, never a
                  // tiny market-price-scaled figure — see
                  // src/lib/timedTrading.ts's settleTimedTradeIfDue, which
                  // this mirrors exactly (direction-aware sign only).
                  const directionalMove = priceIsKnown
                    ? isShort
                      ? trade.entryPrice - coinPrice
                      : coinPrice - trade.entryPrice
                    : null
                  const wouldWin = directionalMove !== null ? directionalMove >= 0 : null
                  const previewPnl = wouldWin === null ? null : wouldWin ? trade.investedAmount : -trade.investedAmount

                  const remainingMs = trade.scheduledCloseAt ? trade.scheduledCloseAt.getTime() - now : 0
                  const settling = remainingMs <= 0
                  const durationLabel =
                    TIMED_TRADE_DURATIONS.find((option) => option.value === trade.duration)?.label ?? trade.duration

                  return (
                    <div
                      key={trade.id}
                      className={`rounded-lg border border-border bg-surface p-2.5 text-[11px] ${
                        isSelected ? 'border-l-2 border-l-accent-gold' : ''
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono font-semibold text-text-primary">{trade.symbol}/USDT</span>
                          <Badge tone={isShort ? 'danger' : 'success'}>{isShort ? 'Short' : 'Long'}</Badge>
                        </div>
                        <Badge tone="success">Open</Badge>
                      </div>
                      <div className="mt-1.5 flex items-center justify-between text-text-muted">
                        <span>
                          Entry <span className="font-mono text-text-primary">{formatUsd(trade.entryPrice)}</span>
                        </span>
                        <span>{durationLabel}</span>
                      </div>
                      <div className="mt-1 flex items-center justify-between text-text-muted">
                        <span>Closes in</span>
                        <span className={`font-mono ${settling ? 'text-accent-gold' : 'text-text-primary'}`}>
                          {settling ? 'Settling…' : formatCountdown(remainingMs)}
                        </span>
                      </div>
                      <div
                        className={`mt-1.5 flex items-center justify-between rounded px-1.5 py-1 ${
                          previewPnl === null
                            ? 'bg-surface-alt'
                            : previewPnl >= 0
                              ? 'bg-success/10'
                              : 'bg-danger/10'
                        }`}
                      >
                        <span className="text-text-muted">P&amp;L</span>
                        {previewPnl === null ? (
                          <span className="text-text-muted">—</span>
                        ) : (
                          <span className={`font-mono font-semibold ${previewPnl >= 0 ? 'text-success' : 'text-danger'}`}>
                            {previewPnl >= 0 ? '+' : ''}
                            {formatUsd(previewPnl)} ({previewPnl >= 0 ? '+' : ''}
                            {previewPnl >= 0 ? 100 : -100}%)
                          </span>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </Card>

          {/* Order History — compact, capped list; the full record still
              lives in Wallet.tsx/AdminTrades.tsx untouched. */}
          <Card className="flex flex-col p-3">
            <div className="flex items-center gap-1.5">
              <History size={12} className="text-text-muted" />
              <h2 className="text-xs font-semibold uppercase tracking-wide text-text-primary">Order History</h2>
            </div>

            {closedTrades.length === 0 ? (
              <p className="mt-2 py-2 text-center text-[11px] text-text-muted">No order history yet.</p>
            ) : (
              <div className="mt-2 max-h-56 space-y-1 overflow-y-auto pr-0.5">
                {closedTrades.slice(0, 25).map((trade) => {
                  const won = trade.result ? trade.result === 'WIN' : (trade.realizedPnl ?? 0) >= 0
                  return (
                    <div key={trade.id} className="flex items-center justify-between rounded-md px-1.5 py-1.5 text-[11px] hover:bg-surface-alt">
                      <div>
                        <p className="font-mono text-text-primary">{trade.symbol}/USDT</p>
                        <p className="text-text-muted">
                          {trade.closedAt
                            ? trade.closedAt.toLocaleString('en-US', { dateStyle: 'short', timeStyle: 'short' })
                            : '—'}
                        </p>
                      </div>
                      <div className="text-right">
                        <Badge tone={trade.direction === 'LONG' ? 'success' : 'danger'}>{trade.direction}</Badge>
                        <p className={`mt-0.5 font-mono font-semibold ${won ? 'text-success' : 'text-danger'}`}>
                          {won ? '+' : '-'}
                          {formatUsd(trade.investedAmount)}
                        </p>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  )
}
