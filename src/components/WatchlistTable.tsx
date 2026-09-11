import { Star } from 'lucide-react'
import type { MarketPrice } from '../lib/api'
import { formatUsd } from '../lib/constants'

interface WatchlistTableProps {
  prices: MarketPrice[]
  loading?: boolean
  /** Which symbols to render as rows, in this order. */
  symbols: string[]
  /** The user's full current watchlist — determines each row's star state. */
  watchlist: string[]
  /** Called with a symbol when its star is clicked. */
  onToggleStar: (symbol: string) => void
}

export default function WatchlistTable({ prices, loading, symbols, watchlist, onToggleStar }: WatchlistTableProps) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[600px] text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-text-muted">
            <th className="w-10 px-4 py-3 font-medium">
              <span className="sr-only">Watchlisted</span>
            </th>
            <th className="px-4 py-3 font-medium">Symbol</th>
            <th className="px-4 py-3 font-medium">Name</th>
            <th className="px-4 py-3 font-medium">24h Move</th>
            <th className="px-4 py-3 font-medium text-right">Price</th>
            <th className="px-4 py-3 font-medium text-right">Change</th>
          </tr>
        </thead>
        <tbody>
          {symbols.map((symbol) => {
            const coin = prices.find((price) => price.symbol === symbol)
            const priceKnown = Boolean(coin && coin.price > 0)
            const isStarred = watchlist.includes(symbol)

            const starButton = (
              <button
                type="button"
                onClick={() => onToggleStar(symbol)}
                className={`flex items-center justify-center rounded p-1 transition-colors ${
                  isStarred ? 'text-accent-gold hover:opacity-70' : 'text-text-muted hover:text-accent-gold'
                }`}
                aria-label={isStarred ? `Remove ${symbol} from watchlist` : `Add ${symbol} to watchlist`}
                aria-pressed={isStarred}
              >
                <Star size={16} fill={isStarred ? 'currentColor' : 'none'} />
              </button>
            )

            if (loading || !priceKnown || !coin) {
              return (
                <tr key={symbol} className="border-b border-border last:border-0">
                  <td className="px-4 py-3">{starButton}</td>
                  <td className="px-4 py-3 font-mono font-semibold text-text-primary">{symbol}</td>
                  <td colSpan={4} className="px-4 py-3">
                    <div className="h-4 w-full max-w-[280px] animate-pulse rounded bg-surface-alt" />
                  </td>
                </tr>
              )
            }

            const isUp = coin.change24h >= 0
            // Scaled visual proxy for a real trend line — bar length reflects
            // the magnitude of the real 24h change (capped at 10%).
            const barWidth = Math.max(Math.min(Math.abs(coin.change24h), 10) * 10, 6)

            return (
              <tr key={symbol} className="border-b border-border last:border-0">
                <td className="px-4 py-3">{starButton}</td>
                <td className="px-4 py-3 font-mono font-semibold text-text-primary">{coin.symbol}</td>
                <td className="px-4 py-3 text-text-muted">{coin.name}</td>
                <td className="px-4 py-3">
                  <div className="h-1.5 w-24 overflow-hidden rounded-full bg-surface-alt">
                    <div
                      className={`h-full rounded-full ${isUp ? 'bg-success' : 'bg-danger'}`}
                      style={{ width: `${barWidth}%` }}
                    />
                  </div>
                </td>
                <td className="px-4 py-3 text-right font-mono text-text-primary">{formatUsd(coin.price)}</td>
                <td className={`px-4 py-3 text-right font-mono ${isUp ? 'text-success' : 'text-danger'}`}>
                  {isUp ? '+' : ''}
                  {coin.change24h.toFixed(2)}%
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
