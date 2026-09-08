import type { MarketPrice } from '../lib/api'
import { TRACKED_SYMBOLS, formatUsd } from '../lib/constants'

interface WatchlistTableProps {
  prices: MarketPrice[]
  loading?: boolean
}

/**
 * There's no per-user watchlist selection yet (no Firestore field for it),
 * so this shows the app's tracked markets as a stand-in "watchlist" — the
 * same live price data already used everywhere else, not a fabricated list.
 */
export default function WatchlistTable({ prices, loading }: WatchlistTableProps) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-text-muted">
            <th className="px-4 py-3 font-medium">Symbol</th>
            <th className="px-4 py-3 font-medium">Name</th>
            <th className="px-4 py-3 font-medium">24h Move</th>
            <th className="px-4 py-3 font-medium text-right">Price</th>
            <th className="px-4 py-3 font-medium text-right">Change</th>
          </tr>
        </thead>
        <tbody>
          {TRACKED_SYMBOLS.map((symbol) => {
            const coin = prices.find((price) => price.symbol === symbol)
            const priceKnown = Boolean(coin && coin.price > 0)

            if (loading || !priceKnown || !coin) {
              return (
                <tr key={symbol} className="border-b border-border last:border-0">
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
