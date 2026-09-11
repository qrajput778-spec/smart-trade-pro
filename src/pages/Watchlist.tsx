import { Link } from 'react-router-dom'
import Card from '../components/Card'
import Button from '../components/Button'
import PageContainer from '../components/PageContainer'
import WatchlistTable from '../components/WatchlistTable'
import { useAuth } from '../context/AuthContext'
import { useMarketData } from '../context/MarketDataContext'
import { useWatchlist } from '../hooks/useWatchlist'
import { TRACKED_SYMBOLS } from '../lib/constants'

export default function Watchlist() {
  const { user } = useAuth()
  const { prices, loading } = useMarketData()
  const { watchlist, toggleSymbol } = useWatchlist(user?.uid)

  // Always iterate in the app's canonical symbol order, not Firestore array
  // insertion order, so this matches Markets/Dashboard's ordering everywhere.
  const starredSymbols = TRACKED_SYMBOLS.filter((symbol) => watchlist.includes(symbol))
  const unstarredSymbols = TRACKED_SYMBOLS.filter((symbol) => !watchlist.includes(symbol))

  return (
    <PageContainer>
      <header>
        <h1 className="text-2xl font-semibold text-text-primary">Watchlist</h1>
        <p className="mt-1 text-sm text-text-muted">
          Live prices for the markets you're tracking, updated every 30 seconds.
        </p>
      </header>

      {starredSymbols.length === 0 ? (
        <Card className="mt-6 flex flex-col items-center gap-3 py-12 text-center">
          <p className="max-w-sm text-text-muted">You haven't added anything to your watchlist yet.</p>
          <Link to="/markets">
            <Button variant="primary">Browse Markets</Button>
          </Link>
        </Card>
      ) : (
        <Card className="mt-6 p-0">
          <WatchlistTable
            prices={prices}
            loading={loading}
            symbols={starredSymbols}
            watchlist={watchlist}
            onToggleStar={toggleSymbol}
          />
        </Card>
      )}

      {/* Only 5 assets exist in total, so surfacing the rest here lets you
          manage the whole watchlist without leaving this page. */}
      {unstarredSymbols.length > 0 && (
        <section className="mt-8">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-text-muted">Add more</h2>
          <Card className="mt-3 p-0">
            <WatchlistTable
              prices={prices}
              loading={loading}
              symbols={unstarredSymbols}
              watchlist={watchlist}
              onToggleStar={toggleSymbol}
            />
          </Card>
        </section>
      )}
    </PageContainer>
  )
}
