import { useEffect, useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import AdminHeader from './AdminHeader'
import AdminSidebar from './AdminSidebar'

/**
 * Standalone application shell for the entire /admin/* area — its own
 * sidebar, header, and content region, completely independent of the
 * normal user Layout/Sidebar/Topbar (see src/components/Layout.tsx, which
 * bypasses its own chrome for any /admin/* path so this is the only shell
 * that renders there). Mounted once via a parent <Route> in App.tsx; each
 * admin page renders into the <Outlet /> below.
 */
export default function AdminLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const location = useLocation()

  // Close the mobile drawer automatically whenever the admin navigates.
  useEffect(() => {
    setSidebarOpen(false)
  }, [location.pathname])

  return (
    <div className="flex min-h-screen w-full bg-background text-text-primary">
      <AdminSidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      {/* min-w-0 is load-bearing — see Layout.tsx for why. */}
      <div className="flex min-w-0 flex-1 flex-col">
        <AdminHeader onOpenSidebar={() => setSidebarOpen(true)} />
        <main className="w-full flex-1 overflow-x-hidden">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
