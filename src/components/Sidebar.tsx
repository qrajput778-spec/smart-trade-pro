import { Link, NavLink } from 'react-router-dom'
import {
  ChevronLeft,
  Compass,
  LayoutDashboard,
  LifeBuoy,
  LineChart,
  PieChart,
  Settings,
  ShieldCheck,
  Star,
  TrendingUp,
  Wallet,
} from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useIsAdmin } from '../hooks/useIsAdmin'

interface NavItem {
  label: string
  to: string
  icon: typeof LayoutDashboard
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

function NavItemLink({ item }: { item: NavItem }) {
  const Icon = item.icon
  return (
    <NavLink
      to={item.to}
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

export default function Sidebar() {
  const { user } = useAuth()
  // Nothing in the UI hints an admin area exists unless this is actually true.
  const { isAdmin } = useIsAdmin(user?.uid)

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
            <NavItemLink item={{ label: 'Admin', to: '/admin', icon: ShieldCheck }} />
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
