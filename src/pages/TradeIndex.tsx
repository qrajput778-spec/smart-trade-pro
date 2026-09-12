import { Navigate } from 'react-router-dom'
import { DEFAULT_TRADE_SYMBOL } from '../lib/constants'

/**
 * /trade with no symbol yet. Previously this rendered a dead-end "pick a
 * market" empty state — now it immediately opens the default market
 * (src/lib/constants.ts's DEFAULT_TRADE_SYMBOL) instead, matching how
 * clicking a coin from Markets.tsx already lands directly on
 * /trade/:symbol. `replace` so this redirect doesn't leave a bare "/trade"
 * entry in browser history for the back button to bounce off of.
 */
export default function TradeIndex() {
  return <Navigate to={`/trade/${DEFAULT_TRADE_SYMBOL}`} replace />
}
