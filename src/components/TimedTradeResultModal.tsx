import { Link } from 'react-router-dom'
import { CheckCircle2, TrendingDown, TrendingUp, XCircle } from 'lucide-react'
import Modal from './Modal'
import Button from './Button'
import { formatUsd } from '../lib/constants'
import { TIMED_TRADE_DURATIONS } from '../lib/timedTrading'
import type { TimedTrade } from '../lib/timedTrading'

function formatTime(date: Date | null): string {
  return date ? date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '—'
}

interface TimedTradeResultModalProps {
  trade: TimedTrade | null
  onClose: () => void
  onTradeAgain: () => void
}

/**
 * Shown once per settled timed trade (see TimedTradesContext's
 * pendingResults queue — this component only ever renders whatever's at
 * the front of that queue, and every value below comes straight off the
 * settled Firestore document, never a placeholder). `trade` is only ever
 * this signed-in user's own — the queue it comes from is built from an
 * owner-scoped subscription — so there's no cross-user leakage to guard
 * against here.
 *
 * Fixed-payout accounting: `trade.result`/`realizedPnl`/`returnAmount` are
 * already exactly WIN/+investedAmount/2x-invested or LOSS/-investedAmount/0
 * — see src/lib/timedTrading.ts's settleTimedTradeIfDue — so this component
 * only ever displays those stored values, never recomputes a P&L amount
 * itself. The `?? investedAmount` fallbacks below only guard against a
 * theoretical malformed/legacy document, not a different accounting path.
 */
export default function TimedTradeResultModal({ trade, onClose, onTradeAgain }: TimedTradeResultModalProps) {
  if (!trade || trade.status !== 'CLOSED') return null

  const won = trade.result ? trade.result === 'WIN' : (trade.realizedPnl ?? 0) >= 0
  const pnl = trade.realizedPnl ?? (won ? trade.investedAmount : -trade.investedAmount)
  const pnlPct = won ? 100 : -100
  const returnAmount = trade.returnAmount ?? (won ? trade.investedAmount * 2 : 0)
  const durationLabel = TIMED_TRADE_DURATIONS.find((option) => option.value === trade.duration)?.label ?? trade.duration

  return (
    <Modal open onClose={onClose} title={`${trade.symbol}/USDT Result`} widthClassName="max-w-[400px]">
      <div className="flex flex-col items-center text-center">
        <div
          className={`flex h-10 w-10 items-center justify-center rounded-full ${
            won ? 'bg-success/10 text-success' : 'bg-danger/10 text-danger'
          }`}
        >
          {won ? <CheckCircle2 size={22} /> : <XCircle size={22} />}
        </div>
        <h3 className={`mt-2 text-base font-bold ${won ? 'text-success' : 'text-danger'}`}>
          {won ? 'Trade Won' : 'Trade Lost'}
        </h3>
        <p className="font-mono text-xs text-text-muted">{trade.symbol}/USDT</p>
      </div>

      <div
        className={`mt-3 rounded-lg border px-3 py-2 text-center ${
          won ? 'border-success/30 bg-success/10' : 'border-danger/30 bg-danger/10'
        }`}
      >
        <p className="text-[10px] uppercase tracking-wide text-text-muted">{won ? 'Profit' : 'Total Loss'}</p>
        <p className={`mt-0.5 font-mono text-xl font-bold ${won ? 'text-success' : 'text-danger'}`}>
          {pnl >= 0 ? '+' : ''}
          {formatUsd(pnl)} <span className="text-sm font-semibold">({pnlPct >= 0 ? '+' : ''}{pnlPct}%)</span>
        </p>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 rounded-lg border border-border bg-surface-alt p-3 text-xs">
        <div>
          <p className="text-[10px] uppercase tracking-wide text-text-muted">Entry Price</p>
          <p className="mt-0.5 font-mono text-text-primary">{formatUsd(trade.entryPrice)}</p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wide text-text-muted">Exit Price</p>
          <p className="mt-0.5 font-mono text-text-primary">{formatUsd(trade.exitPrice ?? 0)}</p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wide text-text-muted">Entry Time</p>
          <p className="mt-0.5 font-mono text-text-primary">{formatTime(trade.openedAt)}</p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wide text-text-muted">Close Time</p>
          <p className="mt-0.5 font-mono text-text-primary">{formatTime(trade.closedAt)}</p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wide text-text-muted">Direction</p>
          <p className={`mt-0.5 flex items-center gap-1 font-semibold ${trade.direction === 'LONG' ? 'text-success' : 'text-danger'}`}>
            {trade.direction === 'LONG' ? (
              <>
                LONG <TrendingUp size={12} />
              </>
            ) : (
              <>
                SHORT <TrendingDown size={12} />
              </>
            )}
          </p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wide text-text-muted">Duration</p>
          <p className="mt-0.5 font-mono text-text-primary">{durationLabel}</p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wide text-text-muted">Quantity</p>
          <p className="mt-0.5 font-mono text-text-primary">
            {trade.quantity} {trade.symbol}
          </p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wide text-text-muted">Invested</p>
          <p className="mt-0.5 font-mono text-text-primary">{formatUsd(trade.investedAmount)}</p>
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between rounded-lg border border-border bg-surface-alt px-3 py-2 text-xs">
        <span className="text-text-muted">Return Amount</span>
        <span className="font-mono font-semibold text-text-primary">{formatUsd(returnAmount)}</span>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
        <Link to="/wallet">
          <Button variant="ghost" className="px-2.5 py-1.5 text-xs" onClick={onClose}>
            View History
          </Button>
        </Link>
        <Button variant="secondary" className="px-2.5 py-1.5 text-xs" onClick={onTradeAgain}>
          Trade Again
        </Button>
        <Button variant={won ? 'primary' : 'danger'} className="px-2.5 py-1.5 text-xs" onClick={onClose}>
          Close
        </Button>
      </div>
    </Modal>
  )
}
