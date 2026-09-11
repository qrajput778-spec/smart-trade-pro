import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { signOut } from 'firebase/auth'
import { Bell, LogOut, Moon, Search, Sun } from 'lucide-react'
import PriceTicker from './PriceTicker'
import { useAuth } from '../context/AuthContext'
import { useMarketData } from '../context/MarketDataContext'
import { useTheme } from '../context/ThemeContext'
import { auth } from '../lib/firebase'

export default function Topbar() {
  const { user } = useAuth()
  const { prices, loading } = useMarketData()
  const { theme, toggleTheme } = useTheme()
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

      <div className="flex items-center gap-4 border-b border-border bg-surface px-6 py-3">
        <div className="flex w-full max-w-md items-center gap-2 rounded-md border border-border bg-surface-alt px-3 py-2 text-sm text-text-muted">
          <Search size={16} className="flex-none" />
          <span className="flex-1 truncate">Search crypto markets, coins, pairs...</span>
          <kbd className="flex-none rounded border border-border px-1.5 py-0.5 font-mono text-[10px] text-text-muted">
            ⌘K
          </kbd>
        </div>

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
          <button
            type="button"
            className="rounded-md p-2 text-text-muted transition-colors hover:text-text-primary"
            aria-label="Notifications"
            title="Notifications (coming soon)"
          >
            <Bell size={18} />
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
