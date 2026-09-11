import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { createUserWithEmailAndPassword, updateProfile } from 'firebase/auth'
import { doc, serverTimestamp, setDoc } from 'firebase/firestore'
import { auth, db } from '../lib/firebase'
import { getAuthErrorMessage } from '../lib/authErrors'
import { STARTING_VIRTUAL_BALANCE, TRACKED_SYMBOLS, formatUsd } from '../lib/constants'
import Card from '../components/Card'
import Button from '../components/Button'
import TextField from '../components/TextField'

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

interface FormErrors {
  displayName?: string
  email?: string
  password?: string
  confirmPassword?: string
  form?: string
}

export default function Signup() {
  const navigate = useNavigate()
  const [displayName, setDisplayName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [errors, setErrors] = useState<FormErrors>({})
  const [submitting, setSubmitting] = useState(false)

  function validate(): FormErrors {
    const next: FormErrors = {}
    if (!displayName.trim()) next.displayName = 'Please enter your name.'
    if (!EMAIL_REGEX.test(email)) next.email = 'Enter a valid email address.'
    // Firebase's own minimum for email/password accounts is 6 characters.
    if (password.length < 6) next.password = 'Password must be at least 6 characters.'
    if (confirmPassword !== password) next.confirmPassword = 'Passwords do not match.'
    return next
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()

    const validationErrors = validate()
    setErrors(validationErrors)
    if (Object.keys(validationErrors).length > 0) return

    if (!auth || !db) {
      setErrors({
        form: 'Firebase is not configured yet — add your project keys to .env to enable accounts.',
      })
      return
    }

    setSubmitting(true)
    try {
      const credential = await createUserWithEmailAndPassword(auth, email, password)
      const trimmedName = displayName.trim()

      await updateProfile(credential.user, { displayName: trimmedName })

      // isAdmin is deliberately never written here (or anywhere client-side)
      // — it's absent by default and only ever flipped by hand in the
      // Firestore console for a specific account.
      await setDoc(doc(db, 'users', credential.user.uid), {
        displayName: trimmedName,
        email,
        balance: STARTING_VIRTUAL_BALANCE,
        holdings: {},
        // Starts with every tracked symbol starred — same default a
        // pre-existing account without this field gets at read time
        // (see useWatchlist), just made explicit from day one.
        watchlist: [...TRACKED_SYMBOLS],
        createdAt: serverTimestamp(),
      })

      navigate('/dashboard')
    } catch (err) {
      setErrors({ form: getAuthErrorMessage(err) })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-[80vh] items-center justify-center px-6 py-12">
      <Card className="w-full max-w-md">
        <h1 className="text-2xl font-semibold text-text-primary">Create your account</h1>
        <p className="mt-1 text-sm text-text-muted">
          Start practicing with {formatUsd(STARTING_VIRTUAL_BALANCE, { maximumFractionDigits: 0 })}{' '}
          in virtual funds. No card, no wallet, no real money.
        </p>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4" noValidate>
          {errors.form && (
            <div className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
              {errors.form}
            </div>
          )}

          <TextField
            label="Display name"
            name="displayName"
            autoComplete="name"
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            error={errors.displayName}
          />
          <TextField
            label="Email"
            name="email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            error={errors.email}
          />
          <TextField
            label="Password"
            name="password"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            error={errors.password}
          />
          <TextField
            label="Confirm password"
            name="confirmPassword"
            type="password"
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            error={errors.confirmPassword}
          />

          <Button type="submit" variant="primary" className="w-full" disabled={submitting}>
            {submitting ? 'Creating account…' : 'Create account'}
          </Button>
        </form>

        <p className="mt-6 text-center text-sm text-text-muted">
          Already have an account?{' '}
          <Link to="/login" className="text-accent-gold hover:underline">
            Log in
          </Link>
        </p>
      </Card>
    </div>
  )
}
