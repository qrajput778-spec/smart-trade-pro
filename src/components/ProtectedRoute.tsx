import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

/**
 * Gates a route behind Firebase auth state AND a verified email. Renders a
 * centered spinner while auth state is still resolving so we never flash a
 * login redirect for a user who is actually signed in.
 *
 * `emailVerified` comes straight from Firebase Auth's own ID token (see
 * AuthContext) — never a Firestore field a client could otherwise write
 * directly — so an unverified account is sent to /verify-email instead of
 * whatever protected page it tried to reach, including via a directly typed
 * URL (this check runs on every render of every route wrapped in
 * ProtectedRoute, not just after a fresh login).
 */
export default function ProtectedRoute({ children }: { children: ReactNode }) {
  const { user, loading, emailVerified } = useAuth()

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div
          className="h-8 w-8 animate-spin rounded-full border-2 border-border border-t-accent-gold"
          role="status"
          aria-label="Loading"
        />
      </div>
    )
  }

  if (!user) {
    return <Navigate to="/login" replace />
  }

  if (!emailVerified) {
    return <Navigate to="/verify-email" replace />
  }

  return <>{children}</>
}
