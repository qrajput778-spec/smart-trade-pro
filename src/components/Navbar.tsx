import { Link, NavLink, useNavigate } from 'react-router-dom'
import { LayoutDashboard, LineChart, Wallet, Settings, LogOut } from 'lucide-react'
import { signOut } from 'firebase/auth'
import { auth } from '../lib/firebase'
import { useAuth } from '../context/AuthContext'
import Button from './Button'

const navLinkClasses = ({ isActive }: { isActive: boolean }) =>
  `flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
    isActive ? 'text-accent-gold bg-accent-gold-soft' : 'text-text-muted hover:text-text-primary'
  }`

export default function Navbar() {
  const { user, loading } = useAuth()
  const navigate = useNavigate()

  async function handleLogout() {
    if (!auth) return
    await signOut(auth)
    navigate('/')
  }

  const displayLabel = user?.displayName || user?.email?.split('@')[0] || 'Account'

  return (
    <nav className="flex items-center justify-between px-6 py-4 border-b border-border bg-surface">
      <Link to="/" className="text-lg font-semibold text-text-primary">
        SMART TRADE <span className="text-accent-gold">PRO</span>
      </Link>
      <div className="flex items-center gap-1">
        {loading ? null : user ? (
          <>
            <NavLink to="/dashboard" className={navLinkClasses}>
              <LayoutDashboard size={16} /> Dashboard
            </NavLink>
            <NavLink to="/markets" className={navLinkClasses}>
              <LineChart size={16} /> Markets
            </NavLink>
            <NavLink to="/portfolio" className={navLinkClasses}>
              <Wallet size={16} /> Portfolio
            </NavLink>
            <NavLink to="/settings" className={navLinkClasses}>
              <Settings size={16} /> Settings
            </NavLink>
            <div className="ml-3 flex items-center gap-3 border-l border-border pl-3">
              <span className="text-sm text-text-muted">{displayLabel}</span>
              <button
                onClick={handleLogout}
                className="flex items-center gap-1 rounded-md px-2 py-1.5 text-sm text-text-muted transition-colors hover:text-danger"
              >
                <LogOut size={16} /> Log out
              </button>
            </div>
          </>
        ) : (
          <>
            <Link
              to="/login"
              className="px-3 py-2 text-sm font-medium text-text-muted transition-colors hover:text-text-primary"
            >
              Login
            </Link>
            <Link to="/signup" className="ml-1">
              <Button variant="primary">Open Account</Button>
            </Link>
          </>
        )}
      </div>
    </nav>
  )
}
