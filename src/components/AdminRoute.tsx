import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useIsAdmin } from '../hooks/useIsAdmin'

/**
 * Gates /admin/* behind auth state, a VERIFIED email, AND isAdmin === true on
 * the signed-in user's own doc. An admin account with an unverified email is
 * sent to /verify-email first — the same real Firebase Auth `emailVerified`
 * check ProtectedRoute uses, never a Firestore field — rather than being let
 * into the admin area just because isAdmin happens to be true. Every other
 * non-admin (including signed-out visitors) is sent to /dashboard, same as
 * any other unauthorized destination; nothing here hints that an admin area
 * exists.
 */
export default function AdminRoute({ children }: { children: ReactNode }) {
  const { user, loading: authLoading, emailVerified } = useAuth()
  const { isAdmin, loading: adminLoading } = useIsAdmin(user?.uid)

  if (authLoading || (user && adminLoading)) {
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

  if (user && !emailVerified) {
    return <Navigate to="/verify-email" replace />
  }

  if (!user || !isAdmin) {
    return <Navigate to="/dashboard" replace />
  }

  return <>{children}</>
}
