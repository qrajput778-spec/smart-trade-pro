import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { onAuthStateChanged, signOut, type User as FirebaseUser } from 'firebase/auth'
import { doc, onSnapshot } from 'firebase/firestore'
import { auth, db } from '../lib/firebase'

interface AuthContextValue {
  user: FirebaseUser | null
  loading: boolean
  /**
   * The signed-in user's REAL Firebase Auth `emailVerified` flag — never a
   * Firestore field, which a client could otherwise write directly. Set
   * from the fresh ID token on every sign-in/sign-out/token-refresh (see
   * onAuthStateChanged below), and explicitly re-read on demand via
   * `refreshEmailVerification` — Firebase does NOT push an update here by
   * itself when the user clicks the verification link in another tab.
   * `false` whenever there's no signed-in user.
   */
  emailVerified: boolean
  /**
   * Reloads the current Firebase Auth user from the server (so a
   * verification click in another tab is picked up) and returns the fresh
   * `emailVerified` value. Used by the "I've verified my email" button on
   * VerifyEmail.tsx. No-op (returns false) if nobody is signed in.
   */
  refreshEmailVerification: () => Promise<boolean>
  /**
   * True once this signed-in user's OWN users/{uid} doc is seen carrying
   * `accountStatus === 'deleted'` or `accessDisabled === true` — the
   * tombstone an admin's "Remove User" writes on the Spark plan, where
   * there is no Admin SDK/backend available to actually delete Firebase
   * Auth credentials (see src/lib/admin.ts's removeUserAccount). The
   * moment this flips true, this same effect signs the account back out —
   * a deactivated account's Firebase Auth credentials remain technically
   * valid forever on Spark, so this Firestore-driven guard is what actually
   * keeps it out of the app, on every future sign-in attempt and for the
   * rest of any session already open elsewhere. Reset to false on the next
   * successful sign-in (by a different, non-deactivated account).
   */
  accountDisabled: boolean
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  loading: true,
  emailVerified: false,
  refreshEmailVerification: async () => false,
  accountDisabled: false,
})

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<FirebaseUser | null>(null)
  const [loading, setLoading] = useState(true)
  const [emailVerified, setEmailVerified] = useState(false)
  const [accountDisabled, setAccountDisabled] = useState(false)

  useEffect(() => {
    if (!auth) {
      // Firebase isn't configured yet (see src/lib/firebase.ts) — treat as signed out.
      setLoading(false)
      return
    }
    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      setUser(firebaseUser)
      // Accurate at this exact moment — sign-in/token-refresh always carries
      // a freshly-issued ID token, which is where the SDK's own
      // `emailVerified` property comes from.
      setEmailVerified(firebaseUser?.emailVerified ?? false)
      setLoading(false)
      // A fresh sign-in (including a brand-new, non-deactivated account)
      // always starts this clean — only the deactivation listener below
      // ever sets it back to true, for THIS uid, based on real Firestore
      // data read after this point.
      if (firebaseUser) setAccountDisabled(false)
    })
    return unsubscribe
  }, [])

  // Watches the signed-in user's OWN profile doc for the "Remove User"
  // tombstone (see accountDisabled's own doc comment above) and force-signs
  // them out the moment it appears — live, not just at the next login, so
  // an account deactivated while already signed in elsewhere loses access
  // right away too, not just on its next sign-in attempt.
  useEffect(() => {
    if (!user || !db || !auth) return
    const authInstance = auth // narrowed to non-null for the callback below, which TS can't infer through the module-level `let`
    const unsubscribe = onSnapshot(doc(db, 'users', user.uid), (snapshot) => {
      const data = snapshot.data()
      const disabled = data?.accountStatus === 'deleted' || data?.accessDisabled === true
      if (disabled) {
        setAccountDisabled(true)
        signOut(authInstance).catch(() => {
          // Best-effort — even if this particular signOut() call fails,
          // accountDisabled is already true, and every protected route
          // guard (ProtectedRoute/AdminRoute) redirects the instant `user`
          // next becomes null, which the next auth-state event will still
          // produce for a genuinely revoked/expired session either way.
        })
      }
    })
    return unsubscribe
  }, [user])

  async function refreshEmailVerification(): Promise<boolean> {
    if (!auth?.currentUser) {
      setEmailVerified(false)
      return false
    }
    await auth.currentUser.reload()
    // `reload()` mutates the SAME FirebaseUser instance in place rather than
    // handing back a new object, so re-setting `user` to it wouldn't trigger
    // a re-render on its own — `emailVerified` is tracked as its own piece
    // of state for exactly that reason. Still re-set `user` too, so any
    // other field a reload might have refreshed (displayName, etc.)
    // propagates to consumers reading it directly.
    setUser(auth.currentUser)
    const verified = auth.currentUser.emailVerified
    setEmailVerified(verified)
    return verified
  }

  return (
    <AuthContext.Provider value={{ user, loading, emailVerified, refreshEmailVerification, accountDisabled }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
