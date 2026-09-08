// Shared holdings valuation math for SMART TRADE PRO.
//
// Pulled out so Dashboard and Portfolio compute "current value" and
// "unrealized P&L" with the exact same logic — two independently-written
// copies of this calculation would be one refactor away from silently
// disagreeing with each other.

import type { MarketPrice } from './api'
import type { HoldingsMap } from '../types'

export interface HoldingRow {
  symbol: string
  qty: number
  avgBuyPrice: number
  currentPrice: number
  costBasis: number
  /** null while this symbol's live price isn't known yet. */
  currentValue: number | null
  pnlAbs: number | null
  pnlPct: number | null
  change24h: number
  priceKnown: boolean
}

export interface HoldingsSummary {
  rows: HoldingRow[]
  /** Rows whose live price is known — the only ones safe to sum. */
  knownRows: HoldingRow[]
  /** True while at least one held symbol's price isn't known yet. */
  pending: boolean
  holdingsValue: number
  totalUnrealizedPnl: number
  totalCostBasis: number
}

export function summarizeHoldings(holdings: HoldingsMap, prices: MarketPrice[]): HoldingsSummary {
  const rows: HoldingRow[] = Object.entries(holdings).map(([symbol, holding]) => {
    const coin = prices.find((price) => price.symbol === symbol)
    const priceKnown = Boolean(coin && coin.price > 0)
    const currentPrice = coin?.price ?? 0
    const costBasis = holding.qty * holding.avgBuyPrice
    const currentValue = priceKnown ? holding.qty * currentPrice : null
    const pnlAbs = currentValue !== null ? currentValue - costBasis : null
    const pnlPct = pnlAbs !== null && costBasis > 0 ? (pnlAbs / costBasis) * 100 : null

    return {
      symbol,
      qty: holding.qty,
      avgBuyPrice: holding.avgBuyPrice,
      currentPrice,
      costBasis,
      currentValue,
      pnlAbs,
      pnlPct,
      change24h: coin?.change24h ?? 0,
      priceKnown,
    }
  })

  const knownRows = rows.filter((row) => row.priceKnown)
  const pending = rows.length > 0 && knownRows.length < rows.length
  const holdingsValue = knownRows.reduce((sum, row) => sum + (row.currentValue ?? 0), 0)
  const totalUnrealizedPnl = knownRows.reduce((sum, row) => sum + (row.pnlAbs ?? 0), 0)
  const totalCostBasis = rows.reduce((sum, row) => sum + row.costBasis, 0)

  return { rows, knownRows, pending, holdingsValue, totalUnrealizedPnl, totalCostBasis }
}
