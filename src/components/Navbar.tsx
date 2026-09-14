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
    <nav className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-border bg-surface px-4 py-4 sm:px-6">
      <Link to="/" className="text-lg font-semibold text-text-primary">
        SMART TRADE <span className="text-accent-gold">PRO</span>
      </Link>
      <div className="flex flex-wrap items-center gap-1">
        {loading ? null : user ? (
          <>
            <NavLink to="/dashboard" className={navLinkClasses}>
              <LayoutDashboard size={16} /> <span className="hidden sm:inline">Dashboard</span>
            </NavLink>
            <NavLink to="/markets" className={navLinkClasses}>
              <LineChart size={16} /> <span className="hidden sm:inline">Markets</span>
            </NavLink>
            <NavLink to="/portfolio" className={navLinkClasses}>
              <Wallet size={16} /> <span className="hidden sm:inline">Portfolio</span>
            </NavLink>
            <NavLink to="/settings" className={navLinkClasses}>
              <Settings size={16} /> <span className="hidden sm:inline">Settings</span>
            </NavLink>
            <div className="ml-1 flex items-center gap-2 border-l border-border pl-2 sm:ml-3 sm:gap-3 sm:pl-3">
              <span className="hidden text-sm text-text-muted md:inline">{displayLabel}</span>
              <button
                onClick={handleLogout}
                className="flex items-center gap-1 rounded-md px-2 py-1.5 text-sm text-text-muted transition-colors hover:text-danger"
              >
                <LogOut size={16} /> <span className="hidden sm:inline">Log out</span>
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
