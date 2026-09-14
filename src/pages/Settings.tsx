import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { doc, onSnapshot } from 'firebase/firestore'
import { signOut } from 'firebase/auth'
import { AlertTriangle, CheckCircle2, Moon, Sun } from 'lucide-react'
import Card from '../components/Card'
import Button from '../components/Button'
import TextField from '../components/TextField'
import PageContainer from '../components/PageContainer'
import { useAuth } from '../context/AuthContext'
import { useTheme } from '../context/ThemeContext'
import { auth, db } from '../lib/firebase'
import { getAuthErrorMessage } from '../lib/authErrors'
import { updateDisplayName, changePassword, deleteAccount, AccountError } from '../lib/account'
import { resetPortfolio } from '../lib/trading'

interface ProfileDoc {
  displayName: string
  email: string
  createdAt: Date | null
}

export default function Settings() {
  const { user } = useAuth()
  const { theme, setTheme } = useTheme()
  const navigate = useNavigate()

  const [profile, setProfile] = useState<ProfileDoc | null>(null)
  const [profileLoading, setProfileLoading] = useState(true)

  useEffect(() => {
    if (!user || !db) {
      setProfileLoading(false)
      return
    }
    const unsubscribe = onSnapshot(doc(db, 'users', user.uid), (snapshot) => {
      const data = snapshot.data()
      const createdAt = data?.createdAt
      setProfile({
        displayName: (data?.displayName as string | undefined) || user.displayName || '',
        email: (data?.email as string | undefined) || user.email || '',
        createdAt: createdAt && typeof createdAt.toDate === 'function' ? createdAt.toDate() : null,
      })
      setProfileLoading(false)
    })
    return unsubscribe
  }, [user])

  // ---- Profile ----
  const [displayNameInput, setDisplayNameInput] = useState('')
  const [savingProfile, setSavingProfile] = useState(false)
  const [profileError, setProfileError] = useState<string | null>(null)
  const [profileSaved, setProfileSaved] = useState(false)

  useEffect(() => {
    if (profile) setDisplayNameInput(profile.displayName)
  }, [profile])

  async function handleSaveProfile(event: FormEvent) {
    event.preventDefault()
    if (!user) return
    setProfileError(null)
    setProfileSaved(false)

    if (!displayNameInput.trim()) {
      setProfileError('Display name cannot be empty.')
      return
    }

    setSavingProfile(true)
    try {
      await updateDisplayName(user, displayNameInput)
      setProfileSaved(true)
    } catch (err) {
      setProfileError(err instanceof AccountError ? err.message : getAuthErrorMessage(err))
    } finally {
      setSavingProfile(false)
    }
  }

  // ---- Security: change password ----
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [changingPassword, setChangingPassword] = useState(false)
  const [passwordError, setPasswordError] = useState<string | null>(null)
  const [passwordSuccess, setPasswordSuccess] = useState(false)

  async function handleChangePassword(event: FormEvent) {
    event.preventDefault()
    if (!user) return
    setPasswordError(null)
    setPasswordSuccess(false)

    if (!currentPassword) {
      setPasswordError('Enter your current password.')
      return
    }
    if (newPassword.length < 6) {
      setPasswordError('New password must be at least 6 characters.')
      return
    }
    if (newPassword !== confirmPassword) {
      setPasswordError('New passwords do not match.')
      return
    }

    setChangingPassword(true)
    try {
      await changePassword(user, currentPassword, newPassword)
      setPasswordSuccess(true)
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
    } catch (err) {
      // Re-authentication failures (wrong current password) and updatePassword
      // failures both come through here as real Firebase Auth error codes —
      // never show the raw Firebase text.
      setPasswordError(getAuthErrorMessage(err))
    } finally {
      setChangingPassword(false)
    }
  }

  // ---- Danger zone: reset portfolio ----
  const [resetPending, setResetPending] = useState(false)
  const [resetError, setResetError] = useState<string | null>(null)

  async function handleResetPortfolio() {
    if (!user) return
    if (
      !window.confirm(
        'Reset your portfolio? This sets your balance back to the starting amount and clears all holdings and realized P&L. This cannot be undone.',
      )
    ) {
      return
    }
    setResetPending(true)
    setResetError(null)
    try {
      await resetPortfolio(user.uid)
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[settings] reset portfolio failed', err)
      setResetError('Could not reset your portfolio — please try again.')
    } finally {
      setResetPending(false)
    }
  }

  // ---- Danger zone: delete account ----
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [deletePassword, setDeletePassword] = useState('')
  const [deleteConfirmText, setDeleteConfirmText] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  function closeDeleteDialog() {
    setDeleteDialogOpen(false)
    setDeletePassword('')
    setDeleteConfirmText('')
    setDeleteError(null)
  }

  async function handleDeleteAccount() {
    if (!user || deleteConfirmText !== 'DELETE' || !deletePassword) return
    setDeleting(true)
    setDeleteError(null)
    try {
      await deleteAccount(user, deletePassword)
      if (auth) await signOut(auth)
      navigate('/')
    } catch (err) {
      setDeleteError(err instanceof AccountError ? err.message : getAuthErrorMessage(err))
      setDeleting(false)
    }
  }

  if (profileLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div
          className="h-8 w-8 animate-spin rounded-full border-2 border-border border-t-accent-gold"
          role="status"
          aria-label="Loading your settings"
        />
      </div>
    )
  }

  return (
    <PageContainer>
      <header>
        <h1 className="text-2xl font-semibold text-text-primary">Settings</h1>
        <p className="mt-1 text-sm text-text-muted">Manage your profile, security, and preferences.</p>
      </header>

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        {/* Profile */}
        <Card>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-text-muted">Profile</h2>
          <form onSubmit={handleSaveProfile} className="mt-4 space-y-4" noValidate>
            <TextField
              label="Display name"
              name="displayName"
              value={displayNameInput}
              onChange={(event) => {
                setDisplayNameInput(event.target.value)
                setProfileSaved(false)
              }}
            />
            <div>
              <label className="block text-sm font-medium text-text-primary">Email</label>
              <input
                value={profile?.email ?? ''}
                readOnly
                disabled
                className="mt-1.5 w-full cursor-not-allowed rounded-md border border-border bg-surface-alt px-3 py-2 text-sm text-text-muted"
              />
              <p className="mt-1 text-xs text-text-muted">Changing email isn't supported in this demo.</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-text-primary">Member since</label>
              <p className="mt-1.5 text-sm text-text-muted">
                {profile?.createdAt
                  ? profile.createdAt.toLocaleDateString('en-US', {
                      year: 'numeric',
                      month: 'long',
                      day: 'numeric',
                    })
                  : '—'}
              </p>
            </div>

            {profileError && <p className="text-xs text-danger">{profileError}</p>}
            {profileSaved && !profileError && (
              <p className="flex items-center gap-1.5 text-xs text-success">
                <CheckCircle2 size={14} /> Profile updated.
              </p>
            )}

            <Button type="submit" variant="primary" disabled={savingProfile}>
              {savingProfile ? 'Saving…' : 'Save changes'}
            </Button>
          </form>
        </Card>

        {/* Security */}
        <Card>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-text-muted">Security</h2>
          <p className="mt-1 text-xs text-text-muted">Change your password.</p>
          <form onSubmit={handleChangePassword} className="mt-4 space-y-4" noValidate>
            <TextField
              label="Current password"
              name="currentPassword"
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
            />
            <TextField
              label="New password"
              name="newPassword"
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
            />
            <TextField
              label="Confirm new password"
              name="confirmPassword"
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
            />

            {passwordError && <p className="text-xs text-danger">{passwordError}</p>}
            {passwordSuccess && !passwordError && (
              <p className="flex items-center gap-1.5 text-xs text-success">
                <CheckCircle2 size={14} /> Password updated.
              </p>
            )}

            <Button type="submit" variant="primary" disabled={changingPassword}>
              {changingPassword ? 'Updating…' : 'Update password'}
            </Button>
          </form>
        </Card>

        {/* Preferences */}
        <Card>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-text-muted">Preferences</h2>
          <p className="mt-1 text-xs text-text-muted">Choose how SMART TRADE PRO looks on this device.</p>

          <div className="mt-4 inline-flex rounded-md border border-border p-1">
            <button
              type="button"
              onClick={() => setTheme('dark')}
              className={`flex items-center gap-2 rounded px-4 py-2 text-sm font-medium transition-colors ${
                theme === 'dark' ? 'bg-accent-gold-soft text-accent-gold' : 'text-text-muted hover:text-text-primary'
              }`}
            >
              <Moon size={16} /> Dark
            </button>
            <button
              type="button"
              onClick={() => setTheme('light')}
              className={`flex items-center gap-2 rounded px-4 py-2 text-sm font-medium transition-colors ${
                theme === 'light' ? 'bg-accent-gold-soft text-accent-gold' : 'text-text-muted hover:text-text-primary'
              }`}
            >
              <Sun size={16} /> Light
            </button>
          </div>
          <p className="mt-3 text-xs text-text-muted">
            This is saved on this device and also controls the theme icon in the top bar.
          </p>
        </Card>

        {/* Danger zone */}
        <Card className="border-danger/40">
          <div className="flex items-center gap-2">
            <AlertTriangle size={16} className="text-danger" />
            <h2 className="text-sm font-semibold uppercase tracking-wide text-danger">Danger Zone</h2>
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-4 border-b border-border pb-4">
            <div>
              <p className="text-sm font-medium text-text-primary">Reset Portfolio</p>
              <p className="mt-1 text-xs text-text-muted">
                Sets your balance back to the starting amount and clears holdings and realized P&amp;L.
              </p>
            </div>
            <Button variant="danger" onClick={handleResetPortfolio} disabled={resetPending} className="flex-none">
              {resetPending ? 'Resetting…' : 'Reset Portfolio'}
            </Button>
          </div>
          {resetError && <p className="mt-2 text-xs text-danger">{resetError}</p>}

          <div className="mt-4 flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-text-primary">Delete Account</p>
              <p className="mt-1 text-xs text-text-muted">
                Permanently deletes your account, balance, holdings, and full trade history.
              </p>
            </div>
            <Button variant="danger" onClick={() => setDeleteDialogOpen(true)} className="flex-none">
              Delete Account
            </Button>
          </div>
        </Card>
      </div>

      {deleteDialogOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
          <Card className="w-full max-w-md border-danger/40">
            <div className="flex items-center gap-2">
              <AlertTriangle size={18} className="text-danger" />
              <h3 className="text-lg font-semibold text-text-primary">Delete your account</h3>
            </div>
            <p className="mt-2 text-sm text-text-muted">
              This permanently deletes your account, virtual balance, holdings, and full trade
              history. This cannot be undone.
            </p>

            <div className="mt-4 space-y-3">
              <TextField
                label="Current password"
                name="deletePassword"
                type="password"
                autoComplete="current-password"
                value={deletePassword}
                onChange={(event) => setDeletePassword(event.target.value)}
              />
              <TextField
                label={'Type "DELETE" to confirm'}
                name="deleteConfirm"
                value={deleteConfirmText}
                onChange={(event) => setDeleteConfirmText(event.target.value)}
                placeholder="DELETE"
              />
            </div>

            {deleteError && <p className="mt-3 text-xs text-danger">{deleteError}</p>}

            <div className="mt-5 flex justify-end gap-3">
              <Button variant="secondary" onClick={closeDeleteDialog} disabled={deleting}>
                Cancel
              </Button>
              <Button
                variant="danger"
                onClick={handleDeleteAccount}
                disabled={deleteConfirmText !== 'DELETE' || !deletePassword || deleting}
              >
                {deleting ? 'Deleting…' : 'Permanently Delete Account'}
              </Button>
            </div>
          </Card>
        </div>
      )}
    </PageContainer>
  )
}
