import Card from '../components/Card'
import PageContainer from '../components/PageContainer'
import WatchlistTable from '../components/WatchlistTable'
import { useMarketData } from '../context/MarketDataContext'

export default function Watchlist() {
  const { prices, loading } = useMarketData()

  return (
    <PageContainer>
      <header>
        <h1 className="text-2xl font-semibold text-text-primary">Watchlist</h1>
        <p className="mt-1 text-sm text-text-muted">
          Live prices for your tracked markets, updated every 30 seconds.
        </p>
      </header>

      <Card className="mt-6 p-0">
        <WatchlistTable prices={prices} loading={loading} />
      </Card>
    </PageContainer>
  )
}
