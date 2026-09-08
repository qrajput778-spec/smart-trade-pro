import { useEffect, useRef, useState } from 'react'
import { getMarketPrices, MARKET_POLL_INTERVAL_MS, type MarketPrice } from '../lib/api'

export interface PricePoint {
  time: number
  price: number
}

interface UseMarketPricesResult {
  prices: MarketPrice[]
  /** Rolling window of recent BTC prices, sampled once per poll — used to draw the hero sparkline. */
  btcHistory: PricePoint[]
  loading: boolean
  error: string | null
}

const MAX_HISTORY_POINTS = 30

/**
 * Polls CoinGecko for live prices every `MARKET_POLL_INTERVAL_MS`. A single
 * instance of this hook is meant to live at the page level and be passed
 * down as props, so multiple sections of the page never each open their own
 * poll against CoinGecko's rate-limited free tier.
 */
export function useMarketPrices(): UseMarketPricesResult {
  const [prices, setPrices] = useState<MarketPrice[]>([])
  const [btcHistory, setBtcHistory] = useState<PricePoint[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const isFirstLoadRef = useRef(true)

  useEffect(() => {
    let cancelled = false

    async function poll() {
      try {
        const data = await getMarketPrices()
        if (cancelled) return

        setPrices(data)
        setError(null)

        const btc = data.find((coin) => coin.symbol === 'BTC')
        if (btc && btc.price > 0) {
          setBtcHistory((prev) => [...prev, { time: Date.now(), price: btc.price }].slice(-MAX_HISTORY_POINTS))
        }
      } catch (err) {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Failed to load market data')
      } finally {
        if (!cancelled && isFirstLoadRef.current) {
          isFirstLoadRef.current = false
          setLoading(false)
        }
      }
    }

    poll()
    const interval = setInterval(poll, MARKET_POLL_INTERVAL_MS)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [])

  return { prices, btcHistory, loading, error }
}
