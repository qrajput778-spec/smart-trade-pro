import { Link, NavLink } from 'react-router-dom'
import {
  BadgeCheck,
  ChevronLeft,
  Compass,
  LayoutDashboard,
  LifeBuoy,
  LineChart,
  PieChart,
  Settings,
  Star,
  TrendingUp,
  Wallet,
  X,
} from 'lucide-react'

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
  { label: 'KYC Verification', to: '/kyc', icon: BadgeCheck },
  { label: 'Support', to: '/support', icon: LifeBuoy },
  { label: 'Settings', to: '/settings', icon: Settings },
]

function NavItemLink({ item, onNavigate }: { item: NavItem; onNavigate: () => void }) {
  const Icon = item.icon
  return (
    <NavLink
      to={item.to}
      end={item.end}
      onClick={onNavigate}
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

interface SidebarProps {
  /** Mobile drawer state — irrelevant at/above the lg breakpoint, where the sidebar is always visible/fixed, exactly as on desktop before this ever existed. */
  open: boolean
  onClose: () => void
}

/**
 * Purely user-facing navigation — the admin area now lives entirely under
 * its own shell (see components/admin/AdminLayout) and is never listed
 * here, even for an admin account. An admin's only entry point into it is
 * the "Admin Panel" link in the Topbar's profile menu (shown only when
 * isAdmin === true) or a direct /admin visit.
 *
 * Desktop (lg+): unchanged from before — a plain sticky column, always
 * visible, no drawer/backdrop machinery in play. Below lg: fixed off-canvas
 * drawer (see AdminSidebar for the identical pattern) — closed by default,
 * toggled by Topbar's hamburger button, and auto-closed on outside-click,
 * Escape, or picking a nav item (see Layout.tsx for the state that drives
 * `open`/`onClose` here).
 */
export default function Sidebar({ open, onClose }: SidebarProps) {
  return (
    <>
      {open && (
        <div className="fixed inset-0 z-30 bg-black/50 lg:hidden" onClick={onClose} aria-hidden="true" />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-40 flex h-screen w-60 flex-none flex-col border-r border-border bg-surface transition-transform duration-200 lg:sticky lg:top-0 lg:translate-x-0 ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex items-center justify-between gap-2 px-5 py-5">
          <Link to="/dashboard" className="flex items-center gap-2" onClick={onClose}>
            <span className="flex h-8 w-8 flex-none items-center justify-center rounded-md bg-accent-gold-soft text-accent-gold">
              <LineChart size={18} />
            </span>
            <span className="text-base font-semibold leading-tight text-text-primary">
              SMART TRADE <span className="text-accent-gold">PRO</span>
            </span>
          </Link>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-text-muted transition-colors hover:text-text-primary lg:hidden"
            aria-label="Close menu"
          >
            <X size={18} />
          </button>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-2">
          {NAV_ITEMS.map((item) => (
            <NavItemLink key={item.to} item={item} onNavigate={onClose} />
          ))}
        </nav>

        <button
          type="button"
          className="hidden items-center justify-center gap-2 border-t border-border py-4 text-text-muted transition-colors hover:text-text-primary lg:flex"
          aria-label="Collapse sidebar"
          title="Collapse sidebar (coming soon)"
        >
          <ChevronLeft size={18} />
        </button>
      </aside>
    </>
  )
}
