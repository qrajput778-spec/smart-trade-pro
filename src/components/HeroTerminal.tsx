import { AreaChart, Area, ResponsiveContainer, YAxis } from 'recharts'
import type { MarketPrice } from '../lib/api'
import type { PricePoint } from '../hooks/useMarketPrices'
import { formatUsd } from '../lib/constants'

interface HeroTerminalProps {
  btc?: MarketPrice
  history: PricePoint[]
  loading: boolean
  error: string | null
}

export default function HeroTerminal({ btc, history, loading, error }: HeroTerminalProps) {
  const isUp = (btc?.change24h ?? 0) >= 0
  const sessionPrices = history.map((point) => point.price)
  const sessionHigh = sessionPrices.length ? Math.max(...sessionPrices) : undefined
  const sessionLow = sessionPrices.length ? Math.min(...sessionPrices) : undefined

  return (
    <div className="rounded-xl border border-border bg-surface overflow-hidden shadow-2xl shadow-black/40">
      <div className="flex items-center gap-1.5 px-4 py-3 border-b border-border bg-surface-alt">
        <span className="h-2.5 w-2.5 rounded-full bg-danger/70" />
        <span className="h-2.5 w-2.5 rounded-full bg-accent-gold/70" />
        <span className="h-2.5 w-2.5 rounded-full bg-success/70" />
        <span className="ml-3 font-mono text-xs text-text-muted">BTC / USDT · simulated feed</span>
      </div>

      <div className="p-5">
        <div className="flex items-baseline justify-between">
          <span className="font-mono text-3xl text-text-primary">
            {!loading && btc && btc.price > 0 ? formatUsd(btc.price) : '—'}
          </span>
          {btc && (
            <span className={`font-mono text-sm ${isUp ? 'text-success' : 'text-danger'}`}>
              {isUp ? '+' : ''}
              {btc.change24h.toFixed(2)}%
            </span>
          )}
        </div>
        {error && <p className="mt-1 text-xs text-danger">Live data temporarily unavailable — retrying…</p>}

        <div className="mt-4 h-28">
          {history.length > 1 ? (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={history} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id="btcSparkline" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#FFD700" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="#FFD700" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <YAxis hide domain={['dataMin', 'dataMax']} />
                <Area
                  type="monotone"
                  dataKey="price"
                  stroke="#FFD700"
                  strokeWidth={2}
                  fill="url(#btcSparkline)"
                  isAnimationActive={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex h-full items-center justify-center font-mono text-xs text-text-muted">
              {loading ? 'Connecting to live feed…' : 'Gathering live price history…'}
            </div>
          )}
        </div>

        <div className="mt-4 grid grid-cols-3 gap-2">
          <StatBox
            label="24H CHANGE"
            value={btc ? `${btc.change24h.toFixed(2)}%` : '—'}
            tone={btc ? (isUp ? 'success' : 'danger') : undefined}
          />
          <StatBox label="SESSION HIGH" value={sessionHigh ? formatUsd(sessionHigh) : '—'} />
          <StatBox label="SESSION LOW" value={sessionLow ? formatUsd(sessionLow) : '—'} />
        </div>
      </div>
    </div>
  )
}

function StatBox({
  label,
  value,
  tone,
}: {
  label: string
  value: string
  tone?: 'success' | 'danger'
}) {
  const toneClass = tone === 'success' ? 'text-success' : tone === 'danger' ? 'text-danger' : 'text-text-primary'
  return (
    <div className="rounded-md border border-border bg-surface-alt px-3 py-2">
      <p className="text-[10px] tracking-wide text-text-muted">{label}</p>
      <p className={`mt-1 font-mono text-sm ${toneClass}`}>{value}</p>
    </div>
  )
}
