import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { sendPasswordResetEmail, signInWithEmailAndPassword, signOut } from 'firebase/auth'
import { doc, getDoc } from 'firebase/firestore'
import { auth, db } from '../lib/firebase'
import { useAuth } from '../context/AuthContext'
import { getAuthErrorMessage } from '../lib/authErrors'
import Card from '../components/Card'
import Button from '../components/Button'
import TextField from '../components/TextField'

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// Exact wording required for a "Remove User"-deactivated account — see
// src/lib/admin.ts's removeUserAccount and AuthContext.tsx's accountDisabled.
const ACCOUNT_DISABLED_MESSAGE =
  'This account has been permanently disabled. Please contact support if you believe this was a mistake.'

interface FormErrors {
  email?: string
  password?: string
  form?: string
}

type ResetState = 'idle' | 'sending' | 'sent'

export default function Login() {
  const navigate = useNavigate()
  const { refreshEmailVerification, accountDisabled } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [errors, setErrors] = useState<FormErrors>({})
  const [submitting, setSubmitting] = useState(false)
  const [resetState, setResetState] = useState<ResetState>('idle')
  const [resetError, setResetError] = useState<string | null>(null)

  // Covers the case where this account was deactivated by an admin WHILE it
  // was already signed in on some other page — AuthContext's own listener
  // force-signs it out and lands here; this just surfaces the same required
  // message once that happens, rather than a silent, unexplained logout.
  useEffect(() => {
    if (accountDisabled) {
      setErrors({ form: ACCOUNT_DISABLED_MESSAGE })
    }
  }, [accountDisabled])

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()

    const nextErrors: FormErrors = {}
    if (!EMAIL_REGEX.test(email)) nextErrors.email = 'Enter a valid email address.'
    if (!password) nextErrors.password = 'Please enter your password.'
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length > 0) return

    if (!auth) {
      setErrors({
        form: 'Firebase is not configured yet — add your project keys to .env to enable accounts.',
      })
      return
    }

    setSubmitting(true)
    try {
      const credential = await signInWithEmailAndPassword(auth, email, password)

      // Firebase Auth credentials for a "Remove User"-deactivated account
      // are still technically valid on the Spark plan (there is no backend
      // able to actually delete them) — so this check, straight against
      // Firestore, is what actually blocks the login. Checked BEFORE the
      // emailVerified flow below: a disabled account should never be routed
      // to /verify-email or /dashboard no matter its verification status.
      if (db) {
        const profileSnapshot = await getDoc(doc(db, 'users', credential.user.uid))
        const profileData = profileSnapshot.data()
        if (profileData?.accountStatus === 'deleted' || profileData?.accessDisabled === true) {
          await signOut(auth)
          setErrors({ form: ACCOUNT_DISABLED_MESSAGE })
          return
        }
      }

      // Never trust the emailVerified value carried over from before this
      // sign-in — reload from the server (via the same AuthContext helper
      // ProtectedRoute/VerifyEmail read from, so its state stays in sync
      // immediately rather than waiting on the next onAuthStateChanged
      // event) so a verification link clicked in another tab/device since
      // the last sign-in is picked up here too.
      const verified = await refreshEmailVerification()
      navigate(verified ? '/dashboard' : '/verify-email')
    } catch (err) {
      setErrors({ form: getAuthErrorMessage(err) })
    } finally {
      setSubmitting(false)
    }
  }

  async function handleForgotPassword() {
    setResetError(null)

    if (!EMAIL_REGEX.test(email)) {
      setResetError('Enter your email above first, then click "Forgot password?" again.')
      return
    }
    if (!auth) {
      setResetError('Firebase is not configured yet — add your project keys to .env.')
      return
    }

    setResetState('sending')
    try {
      await sendPasswordResetEmail(auth, email)
      setResetState('sent')
    } catch (err) {
      setResetState('idle')
      setResetError(getAuthErrorMessage(err))
    }
  }

  return (
    <div className="flex min-h-[80vh] items-center justify-center px-6 py-12">
      <Card className="w-full max-w-md">
        <h1 className="text-2xl font-semibold text-text-primary">Log in</h1>
        <p className="mt-1 text-sm text-text-muted">Access your markets, portfolio, and account tools.</p>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4" noValidate>
          {errors.form && (
            <div className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
              {errors.form}
            </div>
          )}

          <TextField
            label="Email"
            name="email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            error={errors.email}
          />

          <div>
            <TextField
              label="Password"
              name="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              error={errors.password}
            />
            <div className="mt-1.5 text-right">
              <button
                type="button"
                onClick={handleForgotPassword}
                className="text-xs text-text-muted transition-colors hover:text-accent-gold"
              >
                Forgot password?
              </button>
            </div>
          </div>

          {resetState === 'sending' && (
            <p className="text-xs text-text-muted">Sending reset email…</p>
          )}
          {resetState === 'sent' && (
            <p className="text-xs text-success">Password reset email sent — check your inbox.</p>
          )}
          {resetError && <p className="text-xs text-danger">{resetError}</p>}

          <Button type="submit" variant="primary" className="w-full" disabled={submitting}>
            {submitting ? 'Logging in…' : 'Log in'}
          </Button>
        </form>

        <p className="mt-6 text-center text-sm text-text-muted">
          Don't have an account?{' '}
          <Link to="/signup" className="text-accent-gold hover:underline">
            Open one
          </Link>
        </p>
      </Card>
    </div>
  )
}
