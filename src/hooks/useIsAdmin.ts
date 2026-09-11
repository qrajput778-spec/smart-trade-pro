import { useEffect, useState } from 'react'
import { doc, onSnapshot } from 'firebase/firestore'
import { db } from '../lib/firebase'

/**
 * Live read of whether a uid's users/{uid} doc has isAdmin === true.
 * Read-only by design — nothing in this app ever writes this field.
 * Shared by AdminRoute (gating /admin/*) and Sidebar (showing/hiding the
 * Admin link) so both always agree.
 */
export function useIsAdmin(uid: string | undefined) {
  const [isAdmin, setIsAdmin] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!uid || !db) {
      setIsAdmin(false)
      setLoading(false)
      return
    }

    const unsubscribe = onSnapshot(
      doc(db, 'users', uid),
      (snapshot) => {
        setIsAdmin(snapshot.data()?.isAdmin === true)
        setLoading(false)
      },
      () => {
        setIsAdmin(false)
        setLoading(false)
      },
    )

    return unsubscribe
  }, [uid])

  return { isAdmin, loading }
}
