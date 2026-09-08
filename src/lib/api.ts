// Market data fetching for SMART TRADE PRO.
//
// Pulls live spot prices from the public CoinGecko API (no API key required).
// This is display-only market data used to drive the SIMULATED trading
// experience — it never triggers a real order, deposit, or withdrawal.

export interface MarketPrice {
  /** CoinGecko coin id, e.g. "bitcoin" */
  id: string
  /** Ticker symbol, e.g. "BTC" */
  symbol: string
  /** Display name, e.g. "Bitcoin" */
  name: string
  price: number
  change24h: number
}

// CoinGecko free tier is strictly rate-limited — never poll faster than this.
export const MARKET_POLL_INTERVAL_MS = 30_000

const TRACKED_COINS: { id: string; symbol: string; name: string }[] = [
  { id: 'bitcoin', symbol: 'BTC', name: 'Bitcoin' },
  { id: 'ethereum', symbol: 'ETH', name: 'Ethereum' },
  { id: 'solana', symbol: 'SOL', name: 'Solana' },
  { id: 'ripple', symbol: 'XRP', name: 'XRP' },
  { id: 'binancecoin', symbol: 'BNB', name: 'BNB' },
]

const COINGECKO_SIMPLE_PRICE_URL =
  'https://api.coingecko.com/api/v3/simple/price' +
  `?ids=${TRACKED_COINS.map((coin) => coin.id).join(',')}` +
  '&vs_currencies=usd&include_24hr_change=true'

type CoinGeckoSimplePriceResponse = Record<
  string,
  { usd?: number; usd_24h_change?: number } | undefined
>

/**
 * Fetches current USD prices + 24h change for the tracked coins from
 * CoinGecko's public `simple/price` endpoint.
 *
 * Throws on a network failure or non-2xx response (including rate-limit
 * 429s) — callers are expected to handle that and fall back gracefully
 * rather than crash the UI.
 */
export async function getMarketPrices(): Promise<MarketPrice[]> {
  const res = await fetch(COINGECKO_SIMPLE_PRICE_URL)
  if (!res.ok) {
    throw new Error(`CoinGecko request failed with status ${res.status}`)
  }

  const data = (await res.json()) as CoinGeckoSimplePriceResponse

  return TRACKED_COINS.map((coin) => ({
    id: coin.id,
    symbol: coin.symbol,
    name: coin.name,
    price: data[coin.id]?.usd ?? 0,
    change24h: data[coin.id]?.usd_24h_change ?? 0,
  }))
}
