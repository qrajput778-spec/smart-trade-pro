import { useEffect, useState, type FormEvent } from 'react'
import { ArrowLeft, ArrowRight, CheckCircle2, Clock, Copy, DollarSign, Hexagon, Gem, Triangle } from 'lucide-react'
import Button from './Button'
import Modal from './Modal'
import { formatUsd } from '../lib/constants'
import { BalanceRequestError, submitDepositRequest } from '../lib/balanceRequests'
import type { DepositNetwork } from '../types'

interface DepositModalProps {
  open: boolean
  onClose: () => void
  uid: string
  /** Firebase Auth email — the value Firestore rules bind a deposit request to. */
  authenticatedEmail: string
}

/**
 * Configured deposit-network selector. Each option uses the same request
 * workflow and selects the destination shown in the UI.
 */
const DEPOSIT_GATEWAYS = [
  {
    id: 'bep20',
    name: 'BNB Smart Chain (BEP20)' as DepositNetwork,
    subtitle: 'BSC · Binance Smart Chain',
    minNote: 'Minimum request: $0.01',
    eta: '≈1 min',
    icon: Hexagon,
    iconClassName: 'bg-amber-500/15 text-amber-400',
    address: '0x384530e620afe8c3257d1ed531b124ce618e63a8',
  },
  {
    id: 'trc20',
    name: 'Tron (TRC20)' as DepositNetwork,
    subtitle: 'TRX · Tron Network',
    minNote: 'Minimum request: $0.01',
    eta: null,
    icon: Triangle,
    iconClassName: 'bg-red-500/15 text-red-400',
    address: 'TEBccrzx8sXVmD6hfhtyM6uAmULwfcGqUw',
  },
  {
    id: 'erc20',
    name: 'Ethereum (ERC20)' as DepositNetwork,
    subtitle: 'ETH · Ethereum Network',
    minNote: 'Minimum request: $0.001',
    eta: '≈2 mins',
    icon: Gem,
    iconClassName: 'bg-blue-500/15 text-blue-400',
    address: '0x384530e620afe8c3257d1ed531b124ce618e63a8',
  },
] as const

type Step = 'form' | 'review' | 'success'

export default function DepositModal({ open, onClose, uid, authenticatedEmail }: DepositModalProps) {
  const [step, setStep] = useState<Step>('form')
  const [gatewayId, setGatewayId] = useState<(typeof DEPOSIT_GATEWAYS)[number]['id']>('bep20')
  const [amount, setAmount] = useState('')
  const [submittedAmount, setSubmittedAmount] = useState(0)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (open) {
      setStep('form')
      setGatewayId('bep20')
      setAmount('')
      setError(null)
      setCopied(false)
    }
  }, [open])

  const gateway = DEPOSIT_GATEWAYS.find((item) => item.id === gatewayId) ?? DEPOSIT_GATEWAYS[0]

  function handleContinue(event: FormEvent) {
    event.preventDefault()
    setError(null)

    const parsed = Number.parseFloat(amount)
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setError('Enter an amount greater than zero.')
      return
    }

    setSubmittedAmount(parsed)
    setStep('review')
  }

  async function handleCopyAddress() {
    try {
      await navigator.clipboard.writeText(gateway.address)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard access can fail (permissions, insecure context) — non-fatal, just skip the "Copied!" feedback.
    }
  }

  async function handleConfirm() {
    setSubmitting(true)
    setError(null)
    try {
      await submitDepositRequest(uid, authenticatedEmail, submittedAmount, gateway.name, gateway.address)
      setStep('success')
    } catch (err) {
      // Preserve the concise production copy, but make a Firestore failure
      // diagnosable from the development UI and browser console.
      // eslint-disable-next-line no-console
      console.error('[deposit] request submission failed', err)
      const code = typeof err === 'object' && err !== null && 'code' in err ? String(err.code) : null
      setError(
        err instanceof BalanceRequestError
          ? err.message
          : import.meta.env.DEV && code
            ? `Could not submit deposit request (${code}). Check the Firestore rules and account profile.`
            : 'Could not submit deposit request — please try again.',
      )
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Deposit">
      {step === 'form' && (
        <form onSubmit={handleContinue} className="space-y-5" noValidate>
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-text-muted">Deposit USD</p>
            <div className="mt-2 flex gap-2">
              <span className="flex flex-none items-center gap-2 rounded-md border border-border bg-surface-alt px-3 py-2.5 text-sm font-medium text-text-primary">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-success/15 text-success">
                  <DollarSign size={12} />
                </span>
                USD
              </span>
              <input
                type="number"
                min="0.01"
                step="0.01"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                placeholder="0.00"
                autoFocus
                className="w-full rounded-md border border-border bg-surface-alt px-3 py-2.5 text-right font-mono text-sm text-text-primary placeholder:text-text-muted focus:border-accent-gold focus:outline-none focus:ring-1 focus:ring-accent-gold"
              />
            </div>
            <p className="mt-2 text-xs text-text-muted">
              Choose the network for your deposit request below.
            </p>
          </div>

          <div>
            <p className="text-center text-xs font-medium uppercase tracking-wide text-text-muted">
              Choose network
            </p>
            <div className="mt-2 space-y-2">
              {DEPOSIT_GATEWAYS.map((item) => {
                const Icon = item.icon
                const selected = item.id === gatewayId
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setGatewayId(item.id)}
                    className={`flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors ${
                      selected
                        ? 'border-accent-gold bg-accent-gold-soft'
                        : 'border-border bg-surface-alt hover:border-accent-gold/40'
                    }`}
                  >
                    <span className={`flex h-9 w-9 flex-none items-center justify-center rounded-full ${item.iconClassName}`}>
                      <Icon size={16} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className={`text-sm font-semibold ${selected ? 'text-accent-gold' : 'text-text-primary'}`}>
                          {item.name}
                        </span>
                        {item.eta && (
                          <span className="rounded-full bg-accent-gold-soft px-2 py-0.5 text-[10px] font-medium text-accent-gold">
                            {item.eta}
                          </span>
                        )}
                      </span>
                      <span className="mt-0.5 block text-xs text-text-muted">{item.subtitle}</span>
                      <span className="block text-[11px] text-text-muted">{item.minNote}</span>
                    </span>
                  </button>
                )
              })}
            </div>
          </div>

          {error && <p className="text-xs text-danger">{error}</p>}

          <Button type="submit" className="flex w-full items-center justify-center gap-1.5">
            Continue to Deposit <ArrowRight size={15} />
          </Button>
        </form>
      )}

      {step === 'review' && (
        <div className="space-y-5">
          <div>
            <p className="text-sm font-semibold text-text-primary">
              Deposit {formatUsd(submittedAmount)} via {gateway.name}
            </p>
          </div>

          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-text-muted">
              Deposit address ({gateway.id.toUpperCase()})
            </p>
            <div className="mt-2 flex items-center gap-2 rounded-md border border-border bg-surface-alt px-3 py-2.5">
              <span className="flex-1 break-all font-mono text-xs text-accent-gold">{gateway.address}</span>
              <button
                type="button"
                onClick={handleCopyAddress}
                className="flex flex-none items-center gap-1 rounded-md bg-accent-gold px-2.5 py-1.5 text-xs font-medium text-background transition-opacity hover:opacity-90"
              >
                <Copy size={12} /> {copied ? 'Copied!' : 'Copy Address'}
              </button>
            </div>
          </div>

          <p className="flex items-center gap-2 text-xs text-text-muted">
            <Clock size={13} className="flex-none text-accent-gold" />
            Status: Pending — your request is reviewed by an admin before your balance updates.
          </p>

          {error && <p className="text-xs text-danger">{error}</p>}

          <div className="flex gap-3">
            <Button
              type="button"
              variant="secondary"
              className="flex items-center justify-center gap-1.5"
              onClick={() => setStep('form')}
              disabled={submitting}
            >
              <ArrowLeft size={14} /> Back
            </Button>
            <Button type="button" className="flex-1" onClick={handleConfirm} disabled={submitting}>
              {submitting ? 'Submitting…' : 'Submit Deposit Request'}
            </Button>
          </div>
        </div>
      )}

      {step === 'success' && (
        <div className="flex flex-col items-center gap-3 py-4 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-success/10 text-success">
            <CheckCircle2 size={28} />
          </span>
          <div>
            <p className="font-medium text-text-primary">Deposit request submitted</p>
            <p className="mt-1 text-sm text-text-muted">
              Your request for {formatUsd(submittedAmount)} is pending admin review. You'll see it
              update in your request history below once it's reviewed.
            </p>
          </div>
          <Button type="button" className="mt-2 w-full" onClick={onClose}>
            Done
          </Button>
        </div>
      )}
    </Modal>
  )
}
