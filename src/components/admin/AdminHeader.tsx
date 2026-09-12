import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { signOut } from 'firebase/auth'
import { ArrowLeftCircle, LogOut, Menu, ShieldCheck } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { auth } from '../../lib/firebase'

/** Maps the current pathname to a human page title/breadcrumb for the header. */
function resolveAdminTitle(pathname: string): string {
  if (pathname === '/admin') return 'Dashboard'
  if (/^\/admin\/users\/[^/]+\/?$/.test(pathname)) return 'User Details'
  if (pathname.startsWith('/admin/users')) return 'Users'
  if (pathname.startsWith('/admin/trades')) return 'Trades'
  if (pathname.startsWith('/admin/trade-control')) return 'Trade Outcome Control'
  if (pathname.startsWith('/admin/support')) return 'Support'
  if (pathname.startsWith('/admin/deposits')) return 'Deposits'
  if (pathname.startsWith('/admin/withdrawals')) return 'Withdrawals'
  if (pathname.startsWith('/admin/kyc')) return 'KYC Verification'
  return 'Admin'
}

interface AdminHeaderProps {
  onOpenSidebar: () => void
}

export default function AdminHeader({ onOpenSidebar }: AdminHeaderProps) {
  const { user } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  async function handleLogout() {
    if (!auth) return
    await signOut(auth)
    navigate('/')
  }

  const title = resolveAdminTitle(location.pathname)
  const displayLabel = user?.displayName || user?.email?.split('@')[0] || 'Admin'
  const avatarLetter = displayLabel.charAt(0).toUpperCase() || 'A'

  return (
    <div className="sticky top-0 z-20 flex items-center gap-3 border-b border-border bg-surface px-4 py-3 lg:px-6">
      <button
        type="button"
        onClick={onOpenSidebar}
        className="flex-none rounded-md p-2 text-text-muted transition-colors hover:text-text-primary lg:hidden"
        aria-label="Open menu"
      >
        <Menu size={20} />
      </button>

      <div className="min-w-0 flex-1">
        <p className="truncate text-[11px] text-text-muted">
          Admin Panel <span className="mx-1">/</span> <span className="text-text-primary">{title}</span>
        </p>
        <h1 className="truncate text-lg font-semibold text-text-primary">{title}</h1>
      </div>

      <div className="flex flex-none items-center gap-2">
        <Link
          to="/dashboard"
          className="hidden items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-text-muted transition-colors hover:border-accent-gold/40 hover:text-text-primary sm:flex"
        >
          <ArrowLeftCircle size={14} />
          Back to User App
        </Link>

        <span className="hidden items-center gap-1 rounded-full border border-accent-gold/30 bg-accent-gold-soft px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-accent-gold md:flex">
          <ShieldCheck size={12} />
          Admin Panel
        </span>

        <div className="relative" ref={menuRef}>
          <button
            type="button"
            onClick={() => setMenuOpen((open) => !open)}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-accent-gold-soft font-mono text-sm font-semibold text-accent-gold transition-opacity hover:opacity-80"
            aria-label="Admin account menu"
          >
            {avatarLetter}
          </button>

          {menuOpen && (
            <div className="absolute right-0 top-full z-20 mt-2 w-56 rounded-md border border-border bg-surface py-1 shadow-lg">
              <div className="border-b border-border px-3 py-2">
                <p className="truncate text-sm font-medium text-text-primary">{displayLabel}</p>
                <p className="truncate text-xs text-text-muted">{user?.email}</p>
              </div>
              <Link
                to="/dashboard"
                onClick={() => setMenuOpen(false)}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-text-muted transition-colors hover:text-text-primary sm:hidden"
              >
                <ArrowLeftCircle size={16} /> Back to User App
              </Link>
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
  )
}
