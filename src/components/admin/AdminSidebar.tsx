import { Link, NavLink } from 'react-router-dom'
import {
  ArrowDownToLine,
  ArrowLeftRight,
  ArrowUpFromLine,
  BadgeCheck,
  LayoutDashboard,
  LineChart,
  MessageCircle,
  SlidersHorizontal,
  Trash2,
  Users,
  X,
} from 'lucide-react'

interface AdminNavItem {
  label: string
  to: string
  icon: typeof LayoutDashboard
  /** Passed straight to NavLink's own `end` prop — exact-match only. */
  end?: boolean
}

interface AdminNavGroup {
  label: string
  items: AdminNavItem[]
}

const NAV_GROUPS: AdminNavGroup[] = [
  {
    label: 'Overview',
    items: [{ label: 'Dashboard', to: '/admin', icon: LayoutDashboard, end: true }],
  },
  {
    label: 'Management',
    items: [
      { label: 'Users', to: '/admin/users', icon: Users },
      { label: 'Trades', to: '/admin/trades', icon: ArrowLeftRight },
    ],
  },
  {
    label: 'Trading Controls',
    items: [{ label: 'Trade Outcome Control', to: '/admin/trade-control', icon: SlidersHorizontal }],
  },
  {
    label: 'Operations',
    items: [
      { label: 'Support', to: '/admin/support', icon: MessageCircle },
      { label: 'Deposits', to: '/admin/deposits', icon: ArrowDownToLine },
      { label: 'Withdrawals', to: '/admin/withdrawals', icon: ArrowUpFromLine },
      { label: 'KYC Verification', to: '/admin/kyc', icon: BadgeCheck },
    ],
  },
  {
    label: 'System',
    items: [{ label: 'Test Data Cleanup', to: '/admin/cleanup', icon: Trash2 }],
  },
]

function AdminNavLink({ item, onNavigate }: { item: AdminNavItem; onNavigate: () => void }) {
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

interface AdminSidebarProps {
  /** Mobile drawer state — irrelevant above the lg breakpoint, where the sidebar is always visible/fixed. */
  open: boolean
  onClose: () => void
}

/**
 * Standalone navigation shell for everything under /admin/*. Deliberately
 * separate from the main app's Sidebar (see src/components/Sidebar.tsx) —
 * admins browse the normal app with the normal sidebar, and only see this
 * one once they've actually entered the admin panel.
 */
export default function AdminSidebar({ open, onClose }: AdminSidebarProps) {
  return (
    <>
      {open && (
        <div className="fixed inset-0 z-30 bg-black/50 lg:hidden" onClick={onClose} aria-hidden="true" />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-40 flex h-screen w-64 flex-none flex-col border-r border-border bg-surface transition-transform duration-200 lg:sticky lg:top-0 lg:translate-x-0 ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex items-center justify-between gap-2 px-5 py-5">
          <Link to="/admin" className="flex items-center gap-2" onClick={onClose}>
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

        <div className="px-5 pb-4">
          <span className="inline-flex items-center rounded-full border border-accent-gold/30 bg-accent-gold-soft px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-accent-gold">
            Admin Panel
          </span>
        </div>

        <nav className="flex-1 space-y-5 overflow-y-auto px-3 pb-4">
          {NAV_GROUPS.map((group) => (
            <div key={group.label}>
              <p className="px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-wide text-text-muted">
                {group.label}
              </p>
              <div className="space-y-1">
                {group.items.map((item) => (
                  <AdminNavLink key={item.to} item={item} onNavigate={onClose} />
                ))}
              </div>
            </div>
          ))}
        </nav>
      </aside>
    </>
  )
}
