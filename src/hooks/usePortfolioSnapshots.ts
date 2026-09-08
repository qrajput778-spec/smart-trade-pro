import { useEffect, useState } from 'react'
import { collection, limitToLast, onSnapshot, orderBy, query } from 'firebase/firestore'
import { db } from '../lib/firebase'

export interface PortfolioSnapshotPoint {
  id: string
  totalValue: number
  cash: number
  holdingsValue: number
  timestamp: Date | null
}

const SNAPSHOT_LIMIT = 60

/**
 * Live view of a user's users/{uid}/portfolioSnapshots subcollection —
 * one point per Buy/Sell, written by trading.ts. Shared by Dashboard and
 * Portfolio so both charts read the exact same real history.
 */
export function usePortfolioSnapshots(uid: string | undefined) {
  const [snapshots, setSnapshots] = useState<PortfolioSnapshotPoint[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!uid || !db) {
      setLoading(false)
      return
    }

    const snapshotsQuery = query(
      collection(db, 'users', uid, 'portfolioSnapshots'),
      orderBy('timestamp', 'asc'),
      limitToLast(SNAPSHOT_LIMIT),
    )

    const unsubscribe = onSnapshot(
      snapshotsQuery,
      (querySnapshot) => {
        setSnapshots(
          querySnapshot.docs.map((docSnapshot) => {
            const data = docSnapshot.data()
            const timestamp = data.timestamp
            return {
              id: docSnapshot.id,
              totalValue: typeof data.totalValue === 'number' ? data.totalValue : 0,
              cash: typeof data.cash === 'number' ? data.cash : 0,
              holdingsValue: typeof data.holdingsValue === 'number' ? data.holdingsValue : 0,
              timestamp: timestamp && typeof timestamp.toDate === 'function' ? timestamp.toDate() : null,
            }
          }),
        )
        setLoading(false)
      },
      () => setLoading(false),
    )

    return unsubscribe
  }, [uid])

  return { snapshots, loading }
}
