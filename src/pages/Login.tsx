import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { sendPasswordResetEmail, signInWithEmailAndPassword } from 'firebase/auth'
import { auth } from '../lib/firebase'
import { getAuthErrorMessage } from '../lib/authErrors'
import Card from '../components/Card'
import Button from '../components/Button'
import TextField from '../components/TextField'

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

interface FormErrors {
  email?: string
  password?: string
  form?: string
}

type ResetState = 'idle' | 'sending' | 'sent'

export default function Login() {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [errors, setErrors] = useState<FormErrors>({})
  const [submitting, setSubmitting] = useState(false)
  const [resetState, setResetState] = useState<ResetState>('idle')
  const [resetError, setResetError] = useState<string | null>(null)

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
      await signInWithEmailAndPassword(auth, email, password)
      navigate('/dashboard')
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
