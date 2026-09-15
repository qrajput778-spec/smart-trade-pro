import { Link } from 'react-router-dom'
import Badge from '../components/Badge'
import Button from '../components/Button'
import FeatureCard from '../components/FeatureCard'
import HeroTerminal from '../components/HeroTerminal'
import MarketCard from '../components/MarketCard'
import PriceTicker from '../components/PriceTicker'
import { useMarketData } from '../context/MarketDataContext'
import { TRACKED_SYMBOLS, formatUsd } from '../lib/constants'

const FEATURES = [
  {
    index: '01',
    label: 'TRADING',
    title: 'Execute trades',
    description: 'Monitor markets and execute trades with a focused, responsive trading workspace.',
  },
  {
    index: '02',
    label: 'PERFORMANCE',
    title: 'Track your P&L',
    description: 'Follow portfolio performance, review positions, and make informed decisions.',
  },
  {
    index: '03',
    label: 'STRATEGY',
    title: 'Trade with confidence',
    description: 'Build a disciplined approach with clear market data and portfolio insights.',
  },
]

export default function Landing() {
  const { prices, btcHistory, loading, error } = useMarketData()
  const btc = prices.find((coin) => coin.symbol === 'BTC')

  const stats = [
    { label: 'Markets covered', value: `${TRACKED_SYMBOLS.length} (${TRACKED_SYMBOLS.join('/')})` },
    { label: 'Platform availability', value: '24/7' },
    {
      label: 'Account balance',
      value: formatUsd(0, { maximumFractionDigits: 0 }),
    },
    { label: 'Market coverage', value: '24/7' },
  ]

  return (
    <div>
      {/* Hero */}
      <section className="max-w-6xl mx-auto px-6 pt-16 pb-12 grid gap-12 lg:grid-cols-2 lg:items-center">
        <div>
          <Badge tone="gold">ADVANCED CRYPTO TRADING PLATFORM</Badge>
          <h1 className="mt-6 text-4xl sm:text-5xl font-semibold leading-tight text-text-primary">
            Trade Smarter.
            <br />
            <span className="text-accent-gold">Stay Ahead.</span>
          </h1>
          <p className="mt-5 max-w-md text-text-muted">
            Trade smarter with real-time market data, portfolio tools, and a streamlined account experience.
          </p>
          <div className="mt-8">
            <Link to="/signup">
              <Button variant="primary">Get Started →</Button>
            </Link>
          </div>
        </div>

        <HeroTerminal btc={btc} history={btcHistory} loading={loading} error={error} />
      </section>

      {/* Ticker strip */}
      <PriceTicker prices={prices} loading={loading} />

      {/* Live Markets */}
      <section className="max-w-6xl mx-auto px-6 py-16">
        <h2 className="text-2xl font-semibold text-text-primary">Live Markets</h2>
        <p className="mt-2 text-sm text-text-muted">
          Real-time market prices, refreshed every 30 seconds.
        </p>
        <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
          {TRACKED_SYMBOLS.map((symbol) => {
            const coin = prices.find((price) => price.symbol === symbol)
            return <MarketCard key={symbol} coin={coin} loading={loading || !coin} />
          })}
        </div>
        {error && (
          <p className="mt-4 text-xs text-danger">
            Couldn't reach the market data provider — showing the last known values.
          </p>
        )}
      </section>

      {/* Features */}
      <section className="max-w-6xl mx-auto px-6 py-16 border-t border-border">
        <h2 className="text-2xl font-semibold text-text-primary">Built for smarter decisions</h2>
        <div className="mt-8 grid gap-6 sm:grid-cols-3">
          {FEATURES.map((feature) => (
            <FeatureCard key={feature.index} {...feature} />
          ))}
        </div>
      </section>

      {/* Stats bar */}
      <section className="border-y border-border bg-surface">
        <div className="max-w-6xl mx-auto grid grid-cols-2 gap-8 px-6 py-10 text-center sm:grid-cols-4">
          {stats.map((stat) => (
            <div key={stat.label}>
              <p className="font-mono text-2xl text-accent-gold">{stat.value}</p>
              <p className="mt-1 text-xs text-text-muted">{stat.label}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Closing CTA */}
      <section className="max-w-6xl mx-auto px-6 py-20">
        <div className="rounded-lg border border-accent-gold/30 bg-accent-gold-soft px-6 py-12 text-center">
          <h2 className="text-2xl font-semibold text-text-primary sm:text-3xl">
            Ready to get started?
          </h2>
          <p className="mx-auto mt-3 max-w-lg text-text-muted">
            Create an account to explore markets, manage your portfolio, and submit account requests.
          </p>
          <div className="mt-6 flex justify-center">
            <Link to="/signup">
              <Button variant="primary">Create Account →</Button>
            </Link>
          </div>
        </div>
      </section>
    </div>
  )
}
