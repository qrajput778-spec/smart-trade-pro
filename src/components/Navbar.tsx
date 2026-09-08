import { Link, NavLink } from 'react-router-dom'
import { LayoutDashboard, LineChart, Wallet, Settings } from 'lucide-react'

const navLinkClasses = ({ isActive }: { isActive: boolean }) =>
  `flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
    isActive ? 'text-accent-gold bg-accent-gold-soft' : 'text-text-muted hover:text-text-primary'
  }`

export default function Navbar() {
  return (
    <nav className="flex items-center justify-between px-6 py-4 border-b border-border bg-surface">
      <Link to="/" className="text-lg font-semibold text-text-primary">
        SMART TRADE <span className="text-accent-gold">PRO</span>
      </Link>
      <div className="flex items-center gap-1">
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
      </div>
    </nav>
  )
}
