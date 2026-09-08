import type { ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import Navbar from './Navbar'
import Footer from './Footer'
import Sidebar from './Sidebar'
import Topbar from './Topbar'

// Landing/auth pages keep the simple public navbar; everything else lives
// inside the authenticated sidebar app shell.
const PUBLIC_PATHS = new Set(['/', '/login', '/signup'])

export default function Layout({ children }: { children: ReactNode }) {
  const location = useLocation()

  if (PUBLIC_PATHS.has(location.pathname)) {
    return (
      <div className="flex min-h-screen flex-col bg-background text-text-primary">
        <Navbar />
        <main className="flex-1">{children}</main>
        <Footer />
      </div>
    )
  }

  return (
    <div className="flex min-h-screen bg-background text-text-primary">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar />
        <main className="flex-1">{children}</main>
      </div>
    </div>
  )
}
