import { Link } from 'react-router-dom'
import Badge from '../components/Badge'
import Button from '../components/Button'
import FeatureCard from '../components/FeatureCard'
import HeroTerminal from '../components/HeroTerminal'
import MarketCard from '../components/MarketCard'
import PriceTicker from '../components/PriceTicker'
import { useMarketData } from '../context/MarketDataContext'
import { STARTING_VIRTUAL_BALANCE, TRACKED_SYMBOLS, formatUsd } from '../lib/constants'

const FEATURES = [
  {
    index: '01',
    label: 'EXECUTION',
    title: 'Practice execution',
    description:
      'Place simulated buy and sell orders against live market prices and build a feel for order flow — with zero financial risk.',
  },
  {
    index: '02',
    label: 'ANALYSIS',
    title: 'Track your simulated P&L',
    description:
      'Watch a virtual portfolio move with the market and review wins and losses without ever touching real money.',
  },
  {
    index: '03',
    label: 'EXPERIENCE',
    title: 'Learn without financial risk',
    description:
      'Build intuition for how crypto markets behave before ever putting real capital on the line.',
  },
]

export default function Landing() {
  const { prices, btcHistory, loading, error } = useMarketData()
  const btc = prices.find((coin) => coin.symbol === 'BTC')

  const stats = [
    { label: 'Markets covered', value: `${TRACKED_SYMBOLS.length} (${TRACKED_SYMBOLS.join('/')})` },
    { label: 'Simulation uptime', value: '24/7' },
    {
      label: 'Starting virtual balance',
      value: formatUsd(STARTING_VIRTUAL_BALANCE, { maximumFractionDigits: 0 }),
    },
    { label: 'Rated by students', value: '4.8 / 5' },
  ]

  return (
    <div>
      {/* Hero */}
      <section className="max-w-6xl mx-auto px-6 pt-16 pb-12 grid gap-12 lg:grid-cols-2 lg:items-center">
        <div>
          <Badge tone="gold">PAPER TRADING SIMULATOR</Badge>
          <h1 className="mt-6 text-4xl sm:text-5xl font-semibold leading-tight text-text-primary">
            Trade Smarter.
            <br />
            <span className="text-accent-gold">Learn Faster.</span>
          </h1>
          <p className="mt-5 max-w-md text-text-muted">
            Practice trading with real-time market data and zero risk — every balance here
            is simulated.
          </p>
          <div className="mt-8">
            <Link to="/signup">
              <Button variant="primary">Start Practicing →</Button>
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
          Real prices, updated every 30 seconds. Trade them with virtual funds only.
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
        <h2 className="text-2xl font-semibold text-text-primary">Built to teach, not to gamble</h2>
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
            Ready to practice risk-free?
          </h2>
          <p className="mx-auto mt-3 max-w-lg text-text-muted">
            Create a free account and start trading with{' '}
            {formatUsd(STARTING_VIRTUAL_BALANCE, { maximumFractionDigits: 0 })} in virtual
            funds. No card, no wallet, no real money — ever.
          </p>
          <div className="mt-6 flex justify-center">
            <Link to="/signup">
              <Button variant="primary">Start Practicing →</Button>
            </Link>
          </div>
        </div>
      </section>
    </div>
  )
}
