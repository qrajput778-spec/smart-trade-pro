import type { MarketPrice } from '../lib/api'
import { formatUsd } from '../lib/constants'

interface PriceTickerProps {
  prices: MarketPrice[]
  loading?: boolean
}

const PLACEHOLDER_SYMBOLS = ['BTC', 'ETH', 'SOL', 'XRP', 'BNB']

export default function PriceTicker({ prices, loading }: PriceTickerProps) {
  const items = loading || prices.length === 0 ? PLACEHOLDER_SYMBOLS.map((symbol) => ({ symbol })) : prices
  // Duplicate the list so the marquee loop is seamless.
  const looped = [...items, ...items]

  return (
    <div className="border-y border-border bg-surface overflow-hidden">
      <div className="flex w-max animate-marquee">
        {looped.map((item, i) => {
          const coin = 'price' in item ? (item as MarketPrice) : null
          const isUp = (coin?.change24h ?? 0) >= 0
          return (
            <div
              key={`${item.symbol}-${i}`}
              className="flex items-center gap-2 px-6 py-3 border-r border-border font-mono text-sm whitespace-nowrap"
            >
              <span className="text-text-primary font-semibold">{item.symbol}</span>
              <span className="text-text-muted">{coin && coin.price > 0 ? formatUsd(coin.price) : '—'}</span>
              {coin && (
                <span className={isUp ? 'text-success' : 'text-danger'}>
                  {isUp ? '+' : ''}
                  {coin.change24h.toFixed(2)}%
                </span>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
