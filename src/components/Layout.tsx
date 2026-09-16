import { useEffect, useState, type ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import Navbar from './Navbar'
import Footer from './Footer'
import Sidebar from './Sidebar'
import Topbar from './Topbar'

// Landing/auth pages keep the simple public navbar; everything else lives
// inside the authenticated sidebar app shell. /verify-email is reached by a
// signed-in-but-unverified account (see ProtectedRoute/AdminRoute) that
// shouldn't see the full app sidebar — every link in it just bounces back
// here anyway — so it gets the same simple treatment as Login/Signup.
const PUBLIC_PATHS = new Set(['/', '/login', '/signup', '/verify-email'])

export default function Layout({ children }: { children: ReactNode }) {
  const location = useLocation()

  // Mobile/tablet drawer state for the authenticated Sidebar (see
  // Sidebar.tsx) — irrelevant at the lg breakpoint and above, where the
  // sidebar is always visible exactly as before this existed. Closed by
  // default on every navigation, matching AdminLayout's identical pattern.
  const [sidebarOpen, setSidebarOpen] = useState(false)
  useEffect(() => {
    setSidebarOpen(false)
  }, [location.pathname])

  if (PUBLIC_PATHS.has(location.pathname)) {
    return (
      <div className="flex min-h-screen flex-col bg-background text-text-primary">
        <Navbar />
        <main className="flex-1">{children}</main>
        <Footer />
      </div>
    )
  }

  // /admin/* has its own standalone shell (see components/admin/AdminLayout)
  // with its own sidebar/header — never render the normal user chrome there.
  if (location.pathname === '/admin' || location.pathname.startsWith('/admin/')) {
    return <>{children}</>
  }

  return (
    <div className="flex min-h-screen w-full bg-background text-text-primary">
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      {/* min-w-0 is load-bearing here: without it, a flex child won't shrink
          below its content's intrinsic width, which can quietly force this
          column (and everything in it) wider than the space actually left
          next to the fixed-width sidebar. */}
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar onOpenSidebar={() => setSidebarOpen(true)} />
        <main className="w-full flex-1 overflow-x-hidden">{children}</main>
      </div>
    </div>
  )
}
