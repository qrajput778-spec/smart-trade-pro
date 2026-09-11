import { ArrowUpFromLine } from 'lucide-react'
import PageContainer from '../../components/PageContainer'
import BalanceRequestsAdminTable from '../../components/BalanceRequestsAdminTable'

export default function AdminWithdrawals() {
  return (
    <PageContainer>
      <header className="flex items-center gap-2">
        <ArrowUpFromLine size={22} className="text-accent-gold" />
        <div>
          <h1 className="text-2xl font-semibold text-text-primary">Withdrawal Requests</h1>
          <p className="mt-1 text-sm text-text-muted">
            Review and approve simulated withdrawal requests. Approving deducts the user's virtual
            balance — there is no real payout behind any of these.
          </p>
        </div>
      </header>

      <div className="mt-6">
        <BalanceRequestsAdminTable type="withdrawal" />
      </div>
    </PageContainer>
  )
}
