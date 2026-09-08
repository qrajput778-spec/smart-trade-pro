import { Link } from 'react-router-dom'
import { ArrowUpRight, ArrowDownRight } from 'lucide-react'
import Card from './Card'
import type { MarketPrice } from '../lib/api'
import { formatUsd } from '../lib/constants'

interface MarketCardProps {
  coin?: MarketPrice
  loading?: boolean
}

export default function MarketCard({ coin, loading }: MarketCardProps) {
  if (loading || !coin) {
    return (
      <Card className="animate-pulse">
        <div className="h-4 w-16 bg-surface-alt rounded" />
        <div className="mt-4 h-6 w-24 bg-surface-alt rounded" />
        <div className="mt-2 h-4 w-14 bg-surface-alt rounded" />
      </Card>
    )
  }

  const isUp = coin.change24h >= 0

  return (
    <Link to={`/trade/${coin.symbol}`}>
      <Card className="hover:border-accent-gold/40 transition-colors h-full">
        <div className="flex items-center justify-between">
          <span className="font-mono text-sm font-semibold text-text-primary">{coin.symbol}</span>
          <span className="text-xs text-text-muted">{coin.name}</span>
        </div>
        <p className="mt-4 font-mono text-xl text-text-primary">
          {coin.price > 0 ? formatUsd(coin.price) : '—'}
        </p>
        <p
          className={`mt-1 flex items-center gap-1 text-xs font-mono ${
            isUp ? 'text-success' : 'text-danger'
          }`}
        >
          {isUp ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}
          {Math.abs(coin.change24h).toFixed(2)}% (24h)
        </p>
      </Card>
    </Link>
  )
}
