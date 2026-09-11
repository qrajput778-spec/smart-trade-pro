import { useEffect, useState } from 'react'
import { Link, NavLink, useLocation } from 'react-router-dom'
import {
  ArrowLeftRight,
  ChevronDown,
  ChevronLeft,
  Compass,
  LayoutDashboard,
  LifeBuoy,
  LineChart,
  MessageCircle,
  PieChart,
  Settings,
  ShieldCheck,
  Star,
  TrendingUp,
  Users,
  Wallet,
} from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useIsAdmin } from '../hooks/useIsAdmin'

interface NavItem {
  label: string
  to: string
  icon: typeof LayoutDashboard
  /** Passed straight to NavLink's own `end` prop — exact-match only, don't
   *  stay highlighted for deeper routes under this path. */
  end?: boolean
}

const NAV_ITEMS: NavItem[] = [
  { label: 'Dashboard', to: '/dashboard', icon: LayoutDashboard },
  { label: 'Markets', to: '/markets', icon: Compass },
  { label: 'Trading Terminal', to: '/trade', icon: TrendingUp },
  { label: 'Portfolio', to: '/portfolio', icon: PieChart },
  { label: 'Wallet', to: '/wallet', icon: Wallet },
  { label: 'Watchlist', to: '/watchlist', icon: Star },
  { label: 'Support', to: '/support', icon: LifeBuoy },
  { label: 'Settings', to: '/settings', icon: Settings },
]

const ADMIN_SUB_ITEMS: NavItem[] = [
  { label: 'Dashboard', to: '/admin', icon: LayoutDashboard, end: true },
  { label: 'Users', to: '/admin/users', icon: Users },
  { label: 'Trades', to: '/admin/trades', icon: ArrowLeftRight },
  { label: 'Support', to: '/admin/support', icon: MessageCircle },
]

function NavItemLink({ item }: { item: NavItem }) {
  const Icon = item.icon
  return (
    <NavLink
      to={item.to}
      end={item.end}
      className={({ isActive }) =>
        `relative flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition-colors ${
          isActive
            ? 'bg-accent-gold-soft text-accent-gold'
            : 'text-text-muted hover:bg-surface-alt hover:text-text-primary'
        }`
      }
    >
      {({ isActive }) => (
        <>
          {isActive && (
            <span className="absolute left-0 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r bg-accent-gold" />
          )}
          <Icon size={18} />
          {item.label}
        </>
      )}
    </NavLink>
  )
}

/** Same visual language as NavItemLink, just smaller/indented for the
 *  Admin group's sub-items. */
function AdminSubLink({ item }: { item: NavItem }) {
  const Icon = item.icon
  return (
    <NavLink
      to={item.to}
      end={item.end}
      className={({ isActive }) =>
        `relative flex items-center gap-3 rounded-md py-2 pl-9 pr-3 text-sm font-medium transition-colors ${
          isActive
            ? 'bg-accent-gold-soft text-accent-gold'
            : 'text-text-muted hover:bg-surface-alt hover:text-text-primary'
        }`
      }
    >
      {({ isActive }) => (
        <>
          {isActive && (
            <span className="absolute left-0 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r bg-accent-gold" />
          )}
          <Icon size={16} />
          {item.label}
        </>
      )}
    </NavLink>
  )
}

export default function Sidebar() {
  const { user } = useAuth()
  // Nothing in the UI hints an admin area exists unless this is actually true.
  const { isAdmin } = useIsAdmin(user?.uid)
  const location = useLocation()
  const isAdminRouteActive = location.pathname.startsWith('/admin')

  // Starts expanded when the Sidebar mounts while already on an /admin/*
  // route (direct navigation, hard reload) — the initializer runs once
  // against the current location, so there's no flash of "collapsed" first.
  const [adminExpanded, setAdminExpanded] = useState(isAdminRouteActive)

  // If the user navigates into /admin/* by some other means later (a link
  // elsewhere, the back/forward buttons), re-expand automatically too.
  // This only ever forces it open, never closed — manual collapse via the
  // toggle button still works normally while already inside /admin/*.
  useEffect(() => {
    if (isAdminRouteActive) setAdminExpanded(true)
  }, [isAdminRouteActive])

  return (
    <aside className="sticky top-0 flex h-screen w-60 flex-none flex-col border-r border-border bg-surface">
      <Link to="/dashboard" className="flex items-center gap-2 px-5 py-5">
        <span className="flex h-8 w-8 flex-none items-center justify-center rounded-md bg-accent-gold-soft text-accent-gold">
          <LineChart size={18} />
        </span>
        <span className="text-base font-semibold leading-tight text-text-primary">
          SMART TRADE <span className="text-accent-gold">PRO</span>
        </span>
      </Link>

      <nav className="flex-1 space-y-1 px-3 py-2">
        {NAV_ITEMS.map((item) => (
          <NavItemLink key={item.to} item={item} />
        ))}

        {isAdmin && (
          <>
            <div className="my-2 border-t border-border" />

            <button
              type="button"
              onClick={() => setAdminExpanded((prev) => !prev)}
              aria-expanded={adminExpanded}
              className={`relative flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition-colors ${
                isAdminRouteActive
                  ? 'bg-accent-gold-soft text-accent-gold'
                  : 'text-text-muted hover:bg-surface-alt hover:text-text-primary'
              }`}
            >
              {isAdminRouteActive && (
                <span className="absolute left-0 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r bg-accent-gold" />
              )}
              <ShieldCheck size={18} />
              <span className="flex-1 text-left">Admin</span>
              <ChevronDown
                size={16}
                className={`flex-none transition-transform duration-200 ${
                  adminExpanded ? 'rotate-180' : ''
                }`}
              />
            </button>

            {adminExpanded && (
              <div className="space-y-1">
                {ADMIN_SUB_ITEMS.map((item) => (
                  <AdminSubLink key={item.to} item={item} />
                ))}
              </div>
            )}
          </>
        )}
      </nav>

      <button
        type="button"
        className="flex items-center justify-center gap-2 border-t border-border py-4 text-text-muted transition-colors hover:text-text-primary"
        aria-label="Collapse sidebar"
        title="Collapse sidebar (coming soon)"
      >
        <ChevronLeft size={18} />
      </button>
    </aside>
  )
}
