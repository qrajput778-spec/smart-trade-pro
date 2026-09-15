import { ArrowDownToLine } from 'lucide-react'
import PageContainer from '../../components/PageContainer'
import BalanceRequestsAdminTable from '../../components/BalanceRequestsAdminTable'

export default function AdminDeposits() {
  return (
    <PageContainer>
      <header className="flex items-center gap-2">
        <ArrowDownToLine size={22} className="text-accent-gold" />
        <div>
          <h1 className="text-2xl font-semibold text-text-primary">Deposit Requests</h1>
          <p className="mt-1 text-sm text-text-muted">
            Review deposit requests and approve eligible balance updates.
          </p>
        </div>
      </header>

      <div className="mt-6">
        <BalanceRequestsAdminTable type="deposit" />
      </div>
    </PageContainer>
  )
}
