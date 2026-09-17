import { useNavigate, BrowserRouter, Routes, Route } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext'
import { MarketDataProvider } from './context/MarketDataContext'
import { ThemeProvider } from './context/ThemeContext'
import { TimedTradesProvider, useTimedTrades } from './context/TimedTradesContext'
import TimedTradeResultModal from './components/TimedTradeResultModal'
import Layout from './components/Layout'
import ProtectedRoute from './components/ProtectedRoute'
import AdminRoute from './components/AdminRoute'
import AdminLayout from './components/admin/AdminLayout'
import Landing from './pages/Landing'
import Login from './pages/Login'
import Signup from './pages/Signup'
import VerifyEmail from './pages/VerifyEmail'
import Dashboard from './pages/Dashboard'
import Markets from './pages/Markets'
import TradeIndex from './pages/TradeIndex'
import Trade from './pages/Trade'
import Portfolio from './pages/Portfolio'
import WalletPage from './pages/Wallet'
import Watchlist from './pages/Watchlist'
import Support from './pages/Support'
import Settings from './pages/Settings'
import Kyc from './pages/Kyc'
import AdminDashboard from './pages/admin/AdminDashboard'
import AdminUsers from './pages/admin/AdminUsers'
import AdminUserDetail from './pages/admin/AdminUserDetail'
import AdminTrades from './pages/admin/AdminTrades'
import AdminTradeControl from './pages/admin/AdminTradeControl'
import AdminSupport from './pages/admin/AdminSupport'
import AdminDeposits from './pages/admin/AdminDeposits'
import AdminWithdrawals from './pages/admin/AdminWithdrawals'
import AdminKyc from './pages/admin/AdminKyc'
import AdminCleanup from './pages/admin/AdminCleanup'

/**
 * Renders the single next unseen timed-trade result, if any — mounted once
 * inside the router (see App below) so it can appear regardless of which
 * page the user is on when a trade settles, not just the Trading Terminal.
 * "Trade Again" just routes back to that market's Trading Terminal and
 * closes the popup; it never places a new trade itself.
 */
function GlobalTimedTradeResultModal() {
  const { pendingResults, dismissResult } = useTimedTrades()
  const navigate = useNavigate()
  const trade = pendingResults[0] ?? null

  return (
    <TimedTradeResultModal
      trade={trade}
      onClose={() => trade && dismissResult(trade.id)}
      onTradeAgain={() => {
        if (!trade) return
        dismissResult(trade.id)
        navigate(`/trade/${trade.symbol}`)
      }}
    />
  )
}

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <MarketDataProvider>
        <BrowserRouter>
        <TimedTradesProvider>
          <Layout>
            <Routes>
              <Route path="/" element={<Landing />} />
              <Route path="/login" element={<Login />} />
              <Route path="/signup" element={<Signup />} />
              {/* Not wrapped in ProtectedRoute — it applies its own
                  self-contained guard (see VerifyEmail.tsx): signed-out
                  visitors go to /login, already-verified users go straight
                  to /dashboard, so this never becomes a dead end. */}
              <Route path="/verify-email" element={<VerifyEmail />} />
              <Route
                path="/dashboard"
                element={
                  <ProtectedRoute>
                    <Dashboard />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/markets"
                element={
                  <ProtectedRoute>
                    <Markets />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/trade"
                element={
                  <ProtectedRoute>
                    <TradeIndex />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/trade/:symbol"
                element={
                  <ProtectedRoute>
                    <Trade />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/portfolio"
                element={
                  <ProtectedRoute>
                    <Portfolio />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/wallet"
                element={
                  <ProtectedRoute>
                    <WalletPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/watchlist"
                element={
                  <ProtectedRoute>
                    <Watchlist />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/support"
                element={
                  <ProtectedRoute>
                    <Support />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/settings"
                element={
                  <ProtectedRoute>
                    <Settings />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/kyc"
                element={
                  <ProtectedRoute>
                    <Kyc />
                  </ProtectedRoute>
                }
              />
              {/* Standalone admin shell (see components/admin/AdminLayout) — every
                  /admin/* route renders inside it via Outlet, gated as a group by
                  AdminRoute so a non-admin never even mounts the admin chrome. */}
              <Route
                element={
                  <AdminRoute>
                    <AdminLayout />
                  </AdminRoute>
                }
              >
                <Route path="/admin" element={<AdminDashboard />} />
                <Route path="/admin/users" element={<AdminUsers />} />
                <Route path="/admin/users/:uid" element={<AdminUserDetail />} />
                <Route path="/admin/trades" element={<AdminTrades />} />
                <Route path="/admin/trade-control" element={<AdminTradeControl />} />
                <Route path="/admin/support" element={<AdminSupport />} />
                <Route path="/admin/deposits" element={<AdminDeposits />} />
                <Route path="/admin/withdrawals" element={<AdminWithdrawals />} />
                <Route path="/admin/kyc" element={<AdminKyc />} />
                <Route path="/admin/cleanup" element={<AdminCleanup />} />
              </Route>
            </Routes>
          </Layout>
          <GlobalTimedTradeResultModal />
        </TimedTradesProvider>
        </BrowserRouter>
        </MarketDataProvider>
      </AuthProvider>
    </ThemeProvider>
  )
}
