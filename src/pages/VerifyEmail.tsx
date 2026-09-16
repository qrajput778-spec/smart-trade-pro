import { useEffect, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { sendEmailVerification, signOut } from 'firebase/auth'
import { LogOut, MailCheck, RefreshCcw, Send } from 'lucide-react'
import { auth } from '../lib/firebase'
import { useAuth } from '../context/AuthContext'
import { getAuthErrorMessage } from '../lib/authErrors'
import Card from '../components/Card'
import Button from '../components/Button'

// Cheap client-side throttle so a user can't hammer "Resend" — Firebase's
// own auth/too-many-requests error (already mapped by getAuthErrorMessage)
// is still the real backstop, this just avoids firing a request per click.
const RESEND_COOLDOWN_SECONDS = 60

/**
 * The verification-required screen (SIGNUP/LOGIN step 5, VERIFICATION FLOW
 * above). Reached either straight from Signup, from Login when the account
 * isn't verified yet, or via ProtectedRoute/AdminRoute redirecting away from
 * a protected page — always for a real, already-created Firebase Auth
 * account that just hasn't clicked its email link yet.
 *
 * Self-contained rather than wrapped in ProtectedRoute: a signed-out visitor
 * is sent to /login, and an already-verified user is sent straight to
 * /dashboard — so this page never becomes a dead end or an extra step for
 * an account that doesn't need it.
 */
export default function VerifyEmail() {
  const { user, loading, emailVerified, refreshEmailVerification } = useAuth()
  const navigate = useNavigate()

  const [resending, setResending] = useState(false)
  const [resendCooldown, setResendCooldown] = useState(0)
  const [resendMessage, setResendMessage] = useState<string | null>(null)
  const [resendError, setResendError] = useState<string | null>(null)

  const [checking, setChecking] = useState(false)
  const [checkError, setCheckError] = useState<string | null>(null)
  const [stillUnverified, setStillUnverified] = useState(false)

  useEffect(() => {
    if (resendCooldown <= 0) return
    const timer = window.setInterval(() => setResendCooldown((seconds) => Math.max(0, seconds - 1)), 1000)
    return () => window.clearInterval(timer)
  }, [resendCooldown])

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

  // Nobody signed in at all — nothing to verify here.
  if (!user) {
    return <Navigate to="/login" replace />
  }

  // Already verified (e.g. a stale bookmark, or a second tab that caught up
  // via the same onAuthStateChanged event) — no reason to linger here.
  if (emailVerified) {
    return <Navigate to="/dashboard" replace />
  }

  async function handleResend() {
    if (!auth?.currentUser || resending || resendCooldown > 0) return
    setResending(true)
    setResendError(null)
    setResendMessage(null)
    try {
      await sendEmailVerification(auth.currentUser)
      setResendMessage('Verification email sent — check your inbox (and spam folder).')
      setResendCooldown(RESEND_COOLDOWN_SECONDS)
    } catch (err) {
      setResendError(getAuthErrorMessage(err))
    } finally {
      setResending(false)
    }
  }

  async function handleCheckStatus() {
    setChecking(true)
    setCheckError(null)
    setStillUnverified(false)
    try {
      const verified = await refreshEmailVerification()
      if (verified) {
        navigate('/dashboard')
      } else {
        setStillUnverified(true)
      }
    } catch (err) {
      setCheckError(getAuthErrorMessage(err))
    } finally {
      setChecking(false)
    }
  }

  async function handleSignOut() {
    if (auth) await signOut(auth)
    navigate('/login')
  }

  return (
    <div className="flex min-h-[80vh] items-center justify-center px-6 py-12">
      <Card className="w-full max-w-md text-center">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-accent-gold-soft text-accent-gold">
          <MailCheck size={22} />
        </span>
        <h1 className="mt-4 text-2xl font-semibold text-text-primary">Verify your email</h1>
        <p className="mt-2 text-sm text-text-muted">Please verify your email address before continuing.</p>

        <p className="mt-4 truncate rounded-md border border-border bg-surface-alt px-3 py-2 text-sm font-medium text-text-primary">
          {user.email}
        </p>
        <p className="mt-3 text-xs text-text-muted">
          We sent a verification link to this address. Open it, then come back here and check your status below.
        </p>

        {resendMessage && <p className="mt-4 text-xs text-success">{resendMessage}</p>}
        {resendError && <p className="mt-4 text-xs text-danger">{resendError}</p>}
        {stillUnverified && !checkError && (
          <p className="mt-4 text-xs text-danger">
            Still not verified — check your inbox (and spam folder) for the link, then try again.
          </p>
        )}
        {checkError && <p className="mt-4 text-xs text-danger">{checkError}</p>}

        <div className="mt-6 space-y-3">
          <Button
            type="button"
            variant="primary"
            className="flex w-full items-center justify-center gap-2"
            onClick={handleCheckStatus}
            disabled={checking}
          >
            <RefreshCcw size={16} /> {checking ? 'Checking…' : "I've verified my email"}
          </Button>
          <Button
            type="button"
            variant="secondary"
            className="flex w-full items-center justify-center gap-2"
            onClick={handleResend}
            disabled={resending || resendCooldown > 0}
          >
            <Send size={16} />{' '}
            {resending ? 'Sending…' : resendCooldown > 0 ? `Resend available in ${resendCooldown}s` : 'Resend verification email'}
          </Button>
        </div>

        <button
          type="button"
          onClick={handleSignOut}
          className="mt-6 flex w-full items-center justify-center gap-1.5 text-xs text-text-muted transition-colors hover:text-text-primary"
        >
          <LogOut size={14} /> Sign out and use a different account
        </button>
      </Card>
    </div>
  )
}
