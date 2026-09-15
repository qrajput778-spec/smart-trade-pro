import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { signOut } from 'firebase/auth'
import { LogOut, Menu, Moon, ShieldCheck, Sun } from 'lucide-react'
import PriceTicker from './PriceTicker'
import { useAuth } from '../context/AuthContext'
import { useMarketData } from '../context/MarketDataContext'
import { useTheme } from '../context/ThemeContext'
import { useIsAdmin } from '../hooks/useIsAdmin'
import { auth } from '../lib/firebase'

interface TopbarProps {
  /** Opens the mobile Sidebar drawer (see Layout.tsx) — the button below is only ever shown under the lg breakpoint. */
  onOpenSidebar: () => void
}

export default function Topbar({ onOpenSidebar }: TopbarProps) {
  const { user } = useAuth()
  const { prices, loading } = useMarketData()
  const { theme, toggleTheme } = useTheme()
  // Nothing else in the normal app hints an admin area exists unless this is true.
  const { isAdmin } = useIsAdmin(user?.uid)
  const navigate = useNavigate()
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  async function handleLogout() {
    if (!auth) return
    await signOut(auth)
    navigate('/')
  }

  const displayLabel = user?.displayName || user?.email?.split('@')[0] || 'Account'
  const avatarLetter = displayLabel.charAt(0).toUpperCase() || '?'

  return (
    <div className="sticky top-0 z-10 flex flex-col bg-background">
      <PriceTicker prices={prices} loading={loading} />

      <div className="flex items-center gap-3 border-b border-border bg-surface px-4 py-3 sm:gap-4 sm:px-6">
        <button
          type="button"
          onClick={onOpenSidebar}
          className="flex-none rounded-md p-2 text-text-muted transition-colors hover:text-text-primary lg:hidden"
          aria-label="Open menu"
        >
          <Menu size={20} />
        </button>

        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            onClick={toggleTheme}
            className="rounded-md p-2 text-text-muted transition-colors hover:text-text-primary"
            aria-label="Toggle theme"
            title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            {theme === 'dark' ? <Moon size={18} /> : <Sun size={18} />}
          </button>

          <div className="relative ml-2" ref={menuRef}>
            <button
              type="button"
              onClick={() => setMenuOpen((open) => !open)}
              className="flex h-8 w-8 items-center justify-center rounded-full bg-accent-gold-soft font-mono text-sm font-semibold text-accent-gold transition-opacity hover:opacity-80"
              aria-label="Account menu"
            >
              {avatarLetter}
            </button>

            {menuOpen && (
              <div className="absolute right-0 top-full z-20 mt-2 w-52 rounded-md border border-border bg-surface py-1 shadow-lg">
                <div className="border-b border-border px-3 py-2">
                  <p className="truncate text-sm font-medium text-text-primary">{displayLabel}</p>
                  <p className="truncate text-xs text-text-muted">{user?.email}</p>
                </div>
                {isAdmin && (
                  <Link
                    to="/admin"
                    onClick={() => setMenuOpen(false)}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-accent-gold transition-colors hover:bg-accent-gold-soft"
                  >
                    <ShieldCheck size={16} /> Open Admin Panel
                  </Link>
                )}
                <button
                  type="button"
                  onClick={handleLogout}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-text-muted transition-colors hover:text-danger"
                >
                  <LogOut size={16} /> Log out
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
