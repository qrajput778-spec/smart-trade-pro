import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { onAuthStateChanged, type User as FirebaseUser } from 'firebase/auth'
import { auth } from '../lib/firebase'

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
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  loading: true,
  emailVerified: false,
  refreshEmailVerification: async () => false,
})

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<FirebaseUser | null>(null)
  const [loading, setLoading] = useState(true)
  const [emailVerified, setEmailVerified] = useState(false)

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
    })
    return unsubscribe
  }, [])

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
    <AuthContext.Provider value={{ user, loading, emailVerified, refreshEmailVerification }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
