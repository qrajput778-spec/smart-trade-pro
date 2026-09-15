import { useEffect, useState } from 'react'
import { doc, onSnapshot } from 'firebase/firestore'
import { AlertCircle, ArrowDownCircle, ArrowUpCircle, ShieldAlert } from 'lucide-react'
import Card from '../../components/Card'
import Button from '../../components/Button'
import Badge from '../../components/Badge'
import Modal from '../../components/Modal'
import PageContainer from '../../components/PageContainer'
import { useAuth } from '../../context/AuthContext'
import { db } from '../../lib/firebase'
import { AdminActionError, setGlobalTradeOutcomeMode } from '../../lib/admin'
import type { TradeOutcomeMode } from '../../types'

interface OutcomeSettingsState {
  mode: TradeOutcomeMode
  updatedByEmail: string | null
  updatedAt: Date | null
}

const MODE_LABEL: Record<TradeOutcomeMode, string> = {
  NORMAL: 'Normal',
  FORCE_WIN: 'Force Win Active',
  FORCE_LOSS: 'Force Loss Active',
}

/**
 * A single Win/Loss toggle switch. Both cards on this page render one of
 * these bound to the SAME underlying `mode` value, so "only one mode active
 * at a time" is structural (there is one field to be in one of three
 * states), not something this component has to separately enforce.
 */
function ToggleSwitch({ on, disabled, onChange }: { on: boolean; disabled: boolean; onChange: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      disabled={disabled}
      onClick={onChange}
      className={`relative h-6 w-11 flex-none rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
        on ? 'bg-accent-gold' : 'bg-surface-alt border border-border'
      }`}
    >
      <span
        className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
          on ? 'translate-x-[22px]' : 'translate-x-0.5'
        }`}
      />
    </button>
  )
}

/**
 * Global Trade Outcome Control — a persistent admin mode, not a one-time
 * action. Exactly two toggles (Force Win / Force Loss), both reading and
 * writing the single `mode` field on systemSettings/tradeOutcomeControl
 * (src/lib/admin.ts's setGlobalTradeOutcomeMode). Every trade settlement —
 * a user's own Sell/Close of a long, or Cover of a short — reads this same
 * document fresh at the moment it exits (src/lib/trading.ts's
 * executeSellOrder/closeShortOrder) and prices the outcome accordingly, so
 * flipping a toggle here affects trades already open right now (the next
 * time they're closed) as well as every trade opened from now on. There is
 * deliberately no trade list, table, or per-trade control on this page.
 */
export default function AdminTradeControl() {
  const { user: adminUser } = useAuth()

  const [settings, setSettings] = useState<OutcomeSettingsState | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [pendingMode, setPendingMode] = useState<TradeOutcomeMode | null>(null)
  const [processing, setProcessing] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  useEffect(() => {
    if (!db) {
      setLoadError('Firebase is not configured yet — add your project keys to .env.')
      setLoading(false)
      return
    }
    const unsubscribe = onSnapshot(
      doc(db, 'systemSettings', 'tradeOutcomeControl'),
      (snapshot) => {
        const data = snapshot.data()
        const mode: TradeOutcomeMode =
          data?.mode === 'FORCE_WIN' || data?.mode === 'FORCE_LOSS' ? data.mode : 'NORMAL'
        const updatedAt = data?.updatedAt
        setSettings({
          mode,
          updatedByEmail: typeof data?.updatedByEmail === 'string' ? data.updatedByEmail : null,
          updatedAt: updatedAt && typeof updatedAt.toDate === 'function' ? updatedAt.toDate() : null,
        })
        setLoadError(null)
        setLoading(false)
      },
      () => {
        setLoadError('Could not load the global trade outcome setting. The admin Firestore rules may not be deployed yet.')
        setLoading(false)
      },
    )
    return unsubscribe
  }, [])

  const currentMode: TradeOutcomeMode = settings?.mode ?? 'NORMAL'

  function requestModeChange(nextMode: TradeOutcomeMode) {
    setActionError(null)
    setPendingMode(nextMode)
  }

  function closeConfirm() {
    if (processing) return
    setPendingMode(null)
  }

  async function handleConfirm() {
    if (!adminUser || pendingMode === null) return
    setProcessing(true)
    setActionError(null)
    try {
      await setGlobalTradeOutcomeMode(adminUser.uid, adminUser.email, pendingMode)
      setPendingMode(null)
    } catch (err) {
      setActionError(err instanceof AdminActionError ? err.message : 'Could not update the global trade mode — please try again.')
    } finally {
      setProcessing(false)
    }
  }

  const confirmCopy: Record<TradeOutcomeMode, string> = {
    NORMAL: 'Disable the active mode? Trades will return to normal, market-priced settlement.',
    FORCE_WIN:
      'Enable Force Win mode? All currently open and future trades will settle with a winning outcome while this mode remains active.',
    FORCE_LOSS:
      'Enable Force Loss mode? All currently open and future trades will settle with a losing outcome while this mode remains active.',
  }
  const confirmTitle: Record<TradeOutcomeMode, string> = {
    NORMAL: 'Disable Forced Mode',
    FORCE_WIN: 'Enable Force Win Mode',
    FORCE_LOSS: 'Enable Force Loss Mode',
  }
  const confirmButtonLabel: Record<TradeOutcomeMode, string> = {
    NORMAL: 'Disable',
    FORCE_WIN: 'Confirm Force Win',
    FORCE_LOSS: 'Confirm Force Loss',
  }

  return (
    <PageContainer>
      <header className="flex items-center gap-2">
        <ShieldAlert size={22} className="text-accent-gold" />
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold text-text-primary">Global Trade Outcome Control</h1>
            <Badge tone="gold">Outcome Control</Badge>
          </div>
          <p className="mt-1 max-w-2xl text-sm text-text-muted">
            Control configured outcomes for current and future trades.
          </p>
        </div>
      </header>

      {loadError && (
        <Card className="mt-6 border-danger/40">
          <p className="flex items-center gap-2 text-sm text-danger">
            <AlertCircle size={15} className="flex-none" />
            {loadError}
          </p>
        </Card>
      )}
      {actionError && (
        <Card className="mt-6 border-danger/40">
          <p className="flex items-center gap-2 text-sm text-danger">
            <AlertCircle size={15} className="flex-none" />
            {actionError}
          </p>
        </Card>
      )}

      <Card className="mt-6">
        <p className="text-xs uppercase tracking-wide text-text-muted">Current Global Trade Mode</p>
        <p
          className={`mt-1 text-lg font-semibold ${
            currentMode === 'FORCE_WIN'
              ? 'text-success'
              : currentMode === 'FORCE_LOSS'
                ? 'text-danger'
                : 'text-text-primary'
          }`}
        >
          {loading ? 'Loading…' : MODE_LABEL[currentMode]}
        </p>
        {settings && (settings.updatedAt || settings.updatedByEmail) && (
          <p className="mt-1 text-xs text-text-muted">
            Last updated {settings.updatedAt ? settings.updatedAt.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }) : '—'}
            {settings.updatedByEmail ? ` by ${settings.updatedByEmail}` : ''}
          </p>
        )}
      </Card>

      <div className="mt-6 grid gap-6 sm:grid-cols-2">
        <Card className="flex flex-col border-success/30">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-2">
              <ArrowUpCircle size={20} className="text-success" />
              <h2 className="text-base font-semibold text-text-primary">Force Win</h2>
            </div>
            <ToggleSwitch
              on={currentMode === 'FORCE_WIN'}
              disabled={processing || loading}
              onChange={() => requestModeChange(currentMode === 'FORCE_WIN' ? 'NORMAL' : 'FORCE_WIN')}
            />
          </div>
          <p className="mt-3 text-sm text-text-muted">
            All eligible trades will settle profitably while this mode is active.
          </p>
        </Card>

        <Card className="flex flex-col border-danger/30">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-2">
              <ArrowDownCircle size={20} className="text-danger" />
              <h2 className="text-base font-semibold text-text-primary">Force Loss</h2>
            </div>
            <ToggleSwitch
              on={currentMode === 'FORCE_LOSS'}
              disabled={processing || loading}
              onChange={() => requestModeChange(currentMode === 'FORCE_LOSS' ? 'NORMAL' : 'FORCE_LOSS')}
            />
          </div>
          <p className="mt-3 text-sm text-text-muted">
            All eligible trades will settle at a loss while this mode is active.
          </p>
        </Card>
      </div>

      <Modal open={pendingMode !== null} onClose={closeConfirm} title={pendingMode ? confirmTitle[pendingMode] : ''}>
        <p className="text-sm text-text-primary">{pendingMode ? confirmCopy[pendingMode] : ''}</p>

        <div className="mt-5 flex items-center justify-end gap-2">
          <Button variant="ghost" onClick={closeConfirm} disabled={processing}>
            Cancel
          </Button>
          <Button
            variant={pendingMode === 'FORCE_LOSS' ? 'danger' : 'primary'}
            onClick={handleConfirm}
            disabled={processing}
          >
            {processing ? 'Updating…' : pendingMode ? confirmButtonLabel[pendingMode] : ''}
          </Button>
        </div>
      </Modal>
    </PageContainer>
  )
}
