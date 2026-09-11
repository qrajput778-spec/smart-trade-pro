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
      // Deliberately NOT resolving loading to false here. `uid` starts
      // undefined for a brief moment on every hard reload/direct
      // navigation while Firebase Auth is still rehydrating the session —
      // if this branch settled loading:false immediately, a caller like
      // AdminRoute could observe a stale "resolved: not admin" the instant
      // `uid` then flips to the real value (one render before this hook's
      // own effect has re-subscribed for it) and redirect on that stale
      // answer before the real one ever arrives. Both actual consumers
      // here already handle "no uid" correctly without needing `loading`
      // to settle: AdminRoute's own `!user` check short-circuits before it
      // ever looks at `loading`, and Sidebar doesn't read `loading` at all.
      setIsAdmin(false)
      return
    }

    // Reset to loading on every *real* uid we're asked to check — this
    // also correctly re-arms it when switching from one signed-in user to
    // another without a full page reload in between.
    setLoading(true)

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
