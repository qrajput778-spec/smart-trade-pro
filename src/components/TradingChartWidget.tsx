import { useEffect, useRef } from 'react'
import { mountTradingChart, type TradingChartHandle } from '../lib/quotexChart'
import './TradingChartWidget.css'

interface TradingChartWidgetProps {
  /** App-style symbol, e.g. "BTC" (not the chart's internal "BTC/USDT" pair format). */
  symbol: string
  /** Fired when the user picks a different market from the chart's own dropdown. */
  onSymbolChange?: (symbol: string) => void
}

function toPair(symbol: string) {
  return `${symbol}/USDT`
}
function fromPair(pair: string) {
  return pair.split('/')[0]
}

const INDICATOR_OPTIONS: { value: string; label: string; disabled?: boolean }[] = [
  { value: '', label: '＋ Add indicator…' },
  { value: 'vol', label: '────────── Momentum ──────────', disabled: true },
  { value: 'rsi', label: 'RSI (14)' },
  { value: 'stoch', label: 'Stochastic Oscillator' },
  { value: 'macd', label: 'MACD' },
  { value: 'cci', label: 'CCI (20)' },
  { value: 'vol2', label: '────────── Trend ──────────', disabled: true },
  { value: 'sma', label: 'SMA (50)' },
  { value: 'ema', label: 'EMA (20)' },
  { value: 'adx', label: 'ADX (14)' },
  { value: 'supertrend', label: 'SuperTrend' },
  { value: 'ichimoku', label: 'Ichimoku Cloud' },
  { value: 'vol3', label: '────────── Volatility ──────────', disabled: true },
  { value: 'bb', label: 'Bollinger Bands' },
  { value: 'atr', label: 'ATR (14)' },
  { value: 'vol4', label: '────────── Volume / Misc ──────────', disabled: true },
  { value: 'volume', label: 'Volume' },
  { value: 'vwap', label: 'VWAP' },
  { value: 'clear', label: '— Remove all —' },
]

const TIMEFRAME_TABS = ['1m', '5m', '15m', '30m', '1h', '4h', '1D', '1W']

/**
 * The exact candlestick chart (candles, timeframe tabs, indicator engine,
 * market dropdown, live Binance/TradingView feed) originally built as a
 * standalone HTML/canvas prototype — see src/lib/quotexChart.ts for the
 * full porting notes. This component only renders the markup and wires
 * React's lifecycle to that engine; it owns none of the drawing logic
 * itself, so there is exactly one implementation of this chart, not two.
 *
 * The engine mounts once and stays mounted for the component's lifetime —
 * changing `symbol` calls the engine's own `setSymbol` (the same instant,
 * cached-data switch its internal dropdown uses) rather than tearing down
 * and re-fetching everything on every route change.
 */
export default function TradingChartWidget({ symbol, onSymbolChange }: TradingChartWidgetProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const handleRef = useRef<TradingChartHandle | null>(null)

  useEffect(() => {
    if (!containerRef.current) return
    const handle = mountTradingChart(containerRef.current, {
      initialSymbol: toPair(symbol),
      onSymbolChange: (pair) => onSymbolChange?.(fromPair(pair)),
    })
    handleRef.current = handle
    return () => {
      handle.destroy()
      handleRef.current = null
    }
    // Mount once; symbol changes after mount are handled by the effect
    // below via setSymbol, not by tearing down and rebuilding the chart.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    handleRef.current?.setSymbol(toPair(symbol))
  }, [symbol])

  return (
    <div className="stp-chart" ref={containerRef}>
      <div className="stp-chart-wrap">
        <div className="stp-chart-toolbar">
          <span className="stp-sym-big stp-chart-sym">—</span>
          <span className="stp-live-price stp-up">—</span>
          <span className="stp-tick-pct stp-up">—</span>

          <div className="stp-market-dropdown">
            <button type="button" className="stp-market-dropdown-btn">
              {toPair(symbol)} ▼
            </button>
            <div className="stp-market-dropdown-menu" />
          </div>

          <div className="stp-ind-wrap">
            <span className="stp-lbl">INDICATORS</span>
            <select className="stp-ind-select" title="Add indicator — click its chip on the chart to remove" defaultValue="">
              {INDICATOR_OPTIONS.map((opt) => (
                <option key={opt.value || 'default'} value={opt.value} disabled={opt.disabled}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="stp-chart-tabs">
          <span className="stp-tf-label">TIMEFRAME</span>
          {TIMEFRAME_TABS.map((tf) => (
            <button key={tf} type="button" className={`stp-tf-tab${tf === '1m' ? ' active' : ''}`} data-tf={tf}>
              {tf}
            </button>
          ))}
        </div>

        <div className="stp-chart-canvas-wrap">
          <div className="stp-chart-badges">
            <span className="stp-badge gold stp-badge-tf">1m</span>
            <span className="stp-badge stp-badge-market">—</span>
          </div>
          <div className="stp-ind-legend" />
          <canvas className="stp-chart-canvas" />
          <div className="stp-crosshair-tip" />
        </div>
      </div>
    </div>
  )
}
