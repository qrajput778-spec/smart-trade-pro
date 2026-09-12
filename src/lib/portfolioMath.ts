// Shared holdings valuation math for SMART TRADE PRO.
//
// Pulled out so Dashboard and Portfolio compute "current value" and
// "unrealized P&L" with the exact same logic — two independently-written
// copies of this calculation would be one refactor away from silently
// disagreeing with each other.

import { computeShortSettlement } from './trading'
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

// ---------------------------------------------------------------------------
// Short positions ("Sell trades" opened with less spot holding than sold —
// see src/lib/trading.ts's executeShortOrder/closeShortOrder). A short is
// the mirror of a long: it wins when price falls, loses when price rises.
// The actual settlement math (computeShortSettlement) lives in trading.ts
// alongside the rest of the order-execution math; this just reuses it so
// "unrealized P&L" here and the actual cash a close/force-action credits
// can never quietly disagree with each other.
// ---------------------------------------------------------------------------

export interface ShortRow {
  symbol: string
  qty: number
  entryPrice: number
  currentPrice: number
  /** Cash reserved when this short was opened (qty * entryPrice). */
  notional: number
  pnlAbs: number | null
  pnlPct: number | null
  change24h: number
  priceKnown: boolean
}

export interface ShortsSummary {
  rows: ShortRow[]
  knownRows: ShortRow[]
  pending: boolean
  totalNotional: number
  totalUnrealizedPnl: number
}

export function summarizeShorts(shorts: HoldingsMap, prices: MarketPrice[]): ShortsSummary {
  const rows: ShortRow[] = Object.entries(shorts).map(([symbol, short]) => {
    const coin = prices.find((price) => price.symbol === symbol)
    const priceKnown = Boolean(coin && coin.price > 0)
    const currentPrice = coin?.price ?? 0
    const notional = short.qty * short.avgBuyPrice
    const settlement = priceKnown ? computeShortSettlement(short.avgBuyPrice, currentPrice, short.qty) : null
    const pnlAbs = settlement?.pnl ?? null
    const pnlPct = pnlAbs !== null && notional > 0 ? (pnlAbs / notional) * 100 : null

    return {
      symbol,
      qty: short.qty,
      entryPrice: short.avgBuyPrice,
      currentPrice,
      notional,
      pnlAbs,
      pnlPct,
      change24h: coin?.change24h ?? 0,
      priceKnown,
    }
  })

  const knownRows = rows.filter((row) => row.priceKnown)
  const pending = rows.length > 0 && knownRows.length < rows.length
  const totalNotional = rows.reduce((sum, row) => sum + row.notional, 0)
  const totalUnrealizedPnl = knownRows.reduce((sum, row) => sum + (row.pnlAbs ?? 0), 0)

  return { rows, knownRows, pending, totalNotional, totalUnrealizedPnl }
}
