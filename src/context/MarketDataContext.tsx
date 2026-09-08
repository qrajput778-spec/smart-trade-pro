import { createContext, useContext, type ReactNode } from 'react'
import { useMarketPrices } from '../hooks/useMarketPrices'

type MarketDataValue = ReturnType<typeof useMarketPrices>

const MarketDataContext = createContext<MarketDataValue | null>(null)

/**
 * Wraps the app once so every consumer (ticker strip, market overview,
 * watchlist, hero terminal, ...) reads from a single shared CoinGecko poll
 * instead of each mounting its own — CoinGecko's free tier is strictly
 * rate-limited, so this matters once multiple sections show live prices on
 * screen at the same time (e.g. the app shell's Topbar ticker running
 * alongside a Dashboard that also needs live prices).
 */
export function MarketDataProvider({ children }: { children: ReactNode }) {
  const value = useMarketPrices()
  return <MarketDataContext.Provider value={value}>{children}</MarketDataContext.Provider>
}

export function useMarketData(): MarketDataValue {
  const ctx = useContext(MarketDataContext)
  if (!ctx) {
    throw new Error('useMarketData must be used within a MarketDataProvider')
  }
  return ctx
}
