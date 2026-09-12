import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useAuth } from './AuthContext'
import { useMarketData } from './MarketDataContext'
import { subscribeToTimedTrades, settleTimedTradeIfDue, type TimedTrade } from '../lib/timedTrading'

// How often the background sweep re-checks open trades against the clock,
// independent of any new Firestore event — covers a trade whose scheduled
// time arrives while the tab just sits there with nothing else changing.
const SWEEP_INTERVAL_MS = 3000

// A trade closed longer ago than this, that this browser has no prior
// memory of being open, is treated as "too old to pop up for" rather than
// "just settled" — this only matters right after a fresh page load/refresh,
// where every existing document arrives as if newly added.
const RECENT_SETTLEMENT_WINDOW_MS = 3 * 60 * 1000

function shownStorageKey(uid: string) {
  return `stp:timedTradeResultsShown:${uid}`
}

function loadShownIds(uid: string): Set<string> {
  try {
    const raw = localStorage.getItem(shownStorageKey(uid))
    const parsed: unknown = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? new Set(parsed) : new Set()
  } catch {
    return new Set()
  }
}

function saveShownIds(uid: string, ids: Set<string>) {
  try {
    // Cap growth — only the most recent 200 ids are worth keeping around.
    localStorage.setItem(shownStorageKey(uid), JSON.stringify(Array.from(ids).slice(-200)))
  } catch {
    // Storage can be unavailable (private browsing, quota) — losing this
    // tracking only risks one repeated popup later, never a crash.
  }
}

interface TimedTradesContextValue {
  /** This user's own currently OPEN timed trades, live. */
  openTrades: TimedTrade[]
  /** This user's own most recent timed trades (open + closed, newest first, same bound the underlying subscription uses) — for an order-history list. */
  allTrades: TimedTrade[]
  /** Newly-settled trades whose result popup hasn't been shown yet, oldest first. */
  pendingResults: TimedTrade[]
  /** Marks a result as shown (persisted so it never pops up again, even after a refresh) and removes it from the queue. */
  dismissResult: (id: string) => void
}

const TimedTradesContext = createContext<TimedTradesContextValue>({
  openTrades: [],
  allTrades: [],
  pendingResults: [],
  dismissResult: () => {},
})

/**
 * Mounted once, app-wide (see App.tsx) — not just on the Trading Terminal —
 * so background settlement sweeping and the result popup work no matter
 * which page the user is on when a trade's timer expires, and survive
 * closing/reopening the tab (see src/lib/timedTrading.ts's
 * settleTimedTradeIfDue for why duplicate settlement across tabs/refreshes
 * is safe) or the browser sleeping through the scheduled time (the
 * visibilitychange listener below re-sweeps the moment the tab is visible
 * again, rather than trusting a setTimeout that a sleeping tab may never fire).
 */
export function TimedTradesProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const { prices } = useMarketData()
  const pricesRef = useRef(prices)
  pricesRef.current = prices

  const [trades, setTrades] = useState<TimedTrade[]>([])
  const [pendingResults, setPendingResults] = useState<TimedTrade[]>([])
  const shownIdsRef = useRef<Set<string>>(new Set())
  // Tracks each trade's last-seen status so a live OPEN→CLOSED transition
  // (this session watched it happen) can be told apart from a document that
  // simply arrived already-closed on the very first snapshot (e.g. after a
  // refresh) — see RECENT_SETTLEMENT_WINDOW_MS above for how the latter is handled.
  const knownStatusRef = useRef<Map<string, 'OPEN' | 'CLOSED'>>(new Map())

  useEffect(() => {
    if (!user) {
      setTrades([])
      setPendingResults([])
      knownStatusRef.current = new Map()
      return
    }
    shownIdsRef.current = loadShownIds(user.uid)
    knownStatusRef.current = new Map()

    const unsubscribe = subscribeToTimedTrades(
      user.uid,
      (nextTrades) => {
        setTrades(nextTrades)

        const newlySettled: TimedTrade[] = []
        for (const trade of nextTrades) {
          const previousStatus = knownStatusRef.current.get(trade.id)
          knownStatusRef.current.set(trade.id, trade.status)
          if (trade.status !== 'CLOSED') continue
          if (shownIdsRef.current.has(trade.id)) continue

          const justTransitioned = previousStatus === 'OPEN'
          const closedRecently =
            previousStatus === undefined &&
            trade.closedAt !== null &&
            Date.now() - trade.closedAt.getTime() < RECENT_SETTLEMENT_WINDOW_MS
          if (justTransitioned || closedRecently) {
            newlySettled.push(trade)
          }
        }

        if (newlySettled.length > 0) {
          setPendingResults((prev) => {
            const existingIds = new Set(prev.map((entry) => entry.id))
            const additions = newlySettled.filter((entry) => !existingIds.has(entry.id))
            return additions.length > 0 ? [...prev, ...additions] : prev
          })
        }
      },
      () => {
        // Non-fatal — sweeping/the popup just pause; the rest of the app is unaffected.
      },
    )
    return unsubscribe
  }, [user])

  // The background sweep itself — see src/lib/timedTrading.ts's
  // settleTimedTradeIfDue for the atomic, duplicate-safe settlement logic
  // this calls. Re-runs whenever the trade list changes, on a fixed
  // interval, and the instant the tab regains visibility.
  useEffect(() => {
    if (!user) return

    function sweep() {
      const now = Date.now()
      for (const trade of trades) {
        if (trade.status !== 'OPEN' || !trade.scheduledCloseAt) continue
        if (trade.scheduledCloseAt.getTime() > now) continue
        const price = pricesRef.current.find((coin) => coin.symbol === trade.symbol)?.price
        if (!price || price <= 0) continue
        settleTimedTradeIfDue(user!.uid, trade.id, price).catch(() => {
          // A transient failure just means the next sweep tick retries.
        })
      }
    }

    sweep()
    const interval = setInterval(sweep, SWEEP_INTERVAL_MS)
    function handleVisibilityChange() {
      if (document.visibilityState === 'visible') sweep()
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      clearInterval(interval)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [user, trades])

  const dismissResult = useCallback(
    (id: string) => {
      if (!user) return
      shownIdsRef.current.add(id)
      saveShownIds(user.uid, shownIdsRef.current)
      setPendingResults((prev) => prev.filter((entry) => entry.id !== id))
    },
    [user],
  )

  const openTrades = useMemo(() => trades.filter((trade) => trade.status === 'OPEN'), [trades])

  const value = useMemo<TimedTradesContextValue>(
    () => ({ openTrades, allTrades: trades, pendingResults, dismissResult }),
    [openTrades, trades, pendingResults, dismissResult],
  )

  return <TimedTradesContext.Provider value={value}>{children}</TimedTradesContext.Provider>
}

export function useTimedTrades(): TimedTradesContextValue {
  return useContext(TimedTradesContext)
}
