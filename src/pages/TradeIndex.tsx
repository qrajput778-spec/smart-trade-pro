import { Link } from 'react-router-dom'
import { Compass } from 'lucide-react'
import Card from '../components/Card'
import Button from '../components/Button'

/** Landing spot for /trade with no symbol yet — /trade/:symbol is the real terminal. */
export default function TradeIndex() {
  return (
    <div className="mx-auto max-w-2xl px-6 py-16">
      <Card className="flex flex-col items-center gap-4 py-12 text-center">
        <Compass size={32} className="text-accent-gold" />
        <h1 className="text-xl font-semibold text-text-primary">Pick a market to trade</h1>
        <p className="max-w-sm text-sm text-text-muted">
          The trading terminal needs a symbol first. Head to Markets and choose a coin to open
          its terminal.
        </p>
        <Link to="/markets">
          <Button variant="primary">Browse Markets</Button>
        </Link>
      </Card>
    </div>
  )
}
