import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext'
import { MarketDataProvider } from './context/MarketDataContext'
import { ThemeProvider } from './context/ThemeContext'
import Layout from './components/Layout'
import ProtectedRoute from './components/ProtectedRoute'
import AdminRoute from './components/AdminRoute'
import Landing from './pages/Landing'
import Login from './pages/Login'
import Signup from './pages/Signup'
import Dashboard from './pages/Dashboard'
import Markets from './pages/Markets'
import TradeIndex from './pages/TradeIndex'
import Trade from './pages/Trade'
import Portfolio from './pages/Portfolio'
import WalletPage from './pages/Wallet'
import Watchlist from './pages/Watchlist'
import Support from './pages/Support'
import Settings from './pages/Settings'
import AdminDashboard from './pages/admin/AdminDashboard'
import AdminUsers from './pages/admin/AdminUsers'
import AdminUserDetail from './pages/admin/AdminUserDetail'
import AdminTrades from './pages/admin/AdminTrades'
import AdminSupport from './pages/admin/AdminSupport'

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <MarketDataProvider>
        <BrowserRouter>
          <Layout>
            <Routes>
              <Route path="/" element={<Landing />} />
              <Route path="/login" element={<Login />} />
              <Route path="/signup" element={<Signup />} />
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
                path="/admin"
                element={
                  <AdminRoute>
                    <AdminDashboard />
                  </AdminRoute>
                }
              />
              <Route
                path="/admin/users"
                element={
                  <AdminRoute>
                    <AdminUsers />
                  </AdminRoute>
                }
              />
              <Route
                path="/admin/users/:uid"
                element={
                  <AdminRoute>
                    <AdminUserDetail />
                  </AdminRoute>
                }
              />
              <Route
                path="/admin/trades"
                element={
                  <AdminRoute>
                    <AdminTrades />
                  </AdminRoute>
                }
              />
              <Route
                path="/admin/support"
                element={
                  <AdminRoute>
                    <AdminSupport />
                  </AdminRoute>
                }
              />
            </Routes>
          </Layout>
        </BrowserRouter>
        </MarketDataProvider>
      </AuthProvider>
    </ThemeProvider>
  )
}
