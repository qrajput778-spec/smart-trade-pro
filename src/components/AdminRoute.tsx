import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useIsAdmin } from '../hooks/useIsAdmin'

/**
 * Gates /admin/* behind both auth state AND isAdmin === true on the signed-in
 * user's own doc. Non-admins — including signed-out visitors — are sent to
 * /dashboard, the same as any other unauthorized destination; nothing here
 * hints that an admin area exists.
 */
export default function AdminRoute({ children }: { children: ReactNode }) {
  const { user, loading: authLoading } = useAuth()
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

  if (!user || !isAdmin) {
    return <Navigate to="/dashboard" replace />
  }

  return <>{children}</>
}
