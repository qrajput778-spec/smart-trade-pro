import { useState } from 'react'
import { Search } from 'lucide-react'
import MarketCard from '../components/MarketCard'
import PageContainer from '../components/PageContainer'
import { useMarketData } from '../context/MarketDataContext'
import { TRACKED_SYMBOLS } from '../lib/constants'

export default function Markets() {
  const { prices, loading } = useMarketData()
  const [query, setQuery] = useState('')

  const normalizedQuery = query.trim().toLowerCase()
  const visibleSymbols = TRACKED_SYMBOLS.filter((symbol) => {
    if (!normalizedQuery) return true
    const coin = prices.find((price) => price.symbol === symbol)
    return (
      symbol.toLowerCase().includes(normalizedQuery) ||
      Boolean(coin?.name.toLowerCase().includes(normalizedQuery))
    )
  })

  return (
    <PageContainer>
      <header>
        <h1 className="text-2xl font-semibold text-text-primary">Markets</h1>
        <p className="mt-1 text-sm text-text-muted">
          Live prices for your tracked markets, updated every 30 seconds.
        </p>
      </header>

      <div className="mt-6 flex max-w-sm items-center gap-2 rounded-md border border-border bg-surface-alt px-3 py-2 text-sm text-text-muted focus-within:border-accent-gold">
        <Search size={16} className="flex-none" />
        <input
          type="text"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search by symbol or name…"
          className="w-full bg-transparent text-text-primary placeholder:text-text-muted focus:outline-none"
        />
      </div>

      <div className="mt-6 grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-4">
        {visibleSymbols.map((symbol) => {
          const coin = prices.find((price) => price.symbol === symbol)
          return <MarketCard key={symbol} coin={coin} loading={loading || !coin} />
        })}
      </div>

      {visibleSymbols.length === 0 && (
        <p className="mt-8 text-sm text-text-muted">No markets match "{query}".</p>
      )}
    </PageContainer>
  )
}
