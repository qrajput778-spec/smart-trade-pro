import { useEffect, useState } from 'react'
import { doc, onSnapshot, updateDoc } from 'firebase/firestore'
import { db } from '../lib/firebase'
import { TRACKED_SYMBOLS } from '../lib/constants'

const DEFAULT_WATCHLIST: string[] = [...TRACKED_SYMBOLS]

/**
 * Live view of the signed-in user's users/{uid}.watchlist array, plus a
 * toggle to add/remove a symbol. Accounts that predate this field (or that
 * haven't touched their watchlist yet) get a client-side default of all
 * tracked symbols so nothing looks empty — the first toggle then persists a
 * real, explicit array to Firestore going forward.
 *
 * Shared by Dashboard's "My Watchlist" section and the standalone
 * /watchlist page so both read/write the exact same field and can never
 * disagree with each other.
 */
export function useWatchlist(uid: string | undefined) {
  const [watchlist, setWatchlist] = useState<string[]>(DEFAULT_WATCHLIST)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!uid || !db) {
      setLoading(false)
      return
    }

    const unsubscribe = onSnapshot(
      doc(db, 'users', uid),
      (snapshot) => {
        const raw = snapshot.data()?.watchlist
        setWatchlist(
          Array.isArray(raw) ? raw.filter((symbol): symbol is string => typeof symbol === 'string') : DEFAULT_WATCHLIST,
        )
        setLoading(false)
      },
      () => setLoading(false),
    )

    return unsubscribe
  }, [uid])

  async function toggleSymbol(symbol: string) {
    if (!uid || !db) return
    // Always write the full resulting array (computed from the currently
    // displayed list, defaulted or not) rather than relying on Firestore's
    // arrayUnion/arrayRemove — that keeps this correct even on the very
    // first edit, when the field doesn't exist in Firestore yet and the
    // list shown is only the client-side default.
    const isIn = watchlist.includes(symbol)
    const next = isIn ? watchlist.filter((s) => s !== symbol) : [...watchlist, symbol]
    await updateDoc(doc(db, 'users', uid), { watchlist: next })
  }

  return { watchlist, loading, toggleSymbol }
}
