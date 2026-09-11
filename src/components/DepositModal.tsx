import { useEffect, useState, type FormEvent } from 'react'
import { ArrowLeft, ArrowRight, CheckCircle2, Clock, Copy, DollarSign, Hexagon, Gem, ShieldAlert, Triangle } from 'lucide-react'
import Button from './Button'
import Modal from './Modal'
import { formatUsd } from '../lib/constants'
import { BalanceRequestError, submitDepositRequest } from '../lib/balanceRequests'

interface DepositModalProps {
  open: boolean
  onClose: () => void
  uid: string
  email: string
}

/**
 * Purely cosmetic "transfer gateway" selector — Smart Trade Pro is a
 * paper-trading simulator with no real payment rails, so these don't
 * change anything about how the request is processed (every one of them
 * ends up calling the exact same submitDepositRequest). They exist only so
 * the flow reads like a real crypto-exchange deposit screen. The
 * `demoAddress` on each is a fixed, obviously-fake placeholder string —
 * never a real generated/derived blockchain address — shown with an
 * explicit warning not to send anything real to it.
 */
const DEPOSIT_GATEWAYS = [
  {
    id: 'bep20',
    name: 'BNB Smart Chain (BEP20)',
    subtitle: 'BSC · Binance Smart Chain (simulated)',
    minNote: 'Min >0.01 USD (simulated)',
    eta: '≈1 min',
    icon: Hexagon,
    iconClassName: 'bg-amber-500/15 text-amber-400',
    demoAddress: '0x71C7a3B29D4E5F6a7B8c9D0e1F2a3B4c5D6e7F80',
  },
  {
    id: 'trc20',
    name: 'Tron (TRC20)',
    subtitle: 'TRX · Tron Network (simulated)',
    minNote: 'Min >0.01 USD (simulated)',
    eta: null,
    icon: Triangle,
    iconClassName: 'bg-red-500/15 text-red-400',
    demoAddress: 'TDem0F3k2M8pQ7rS1tU4vW6xY0zA2bC3dE9fGh',
  },
  {
    id: 'erc20',
    name: 'Ethereum (ERC20)',
    subtitle: 'ETH · Ethereum Network (simulated)',
    minNote: 'Min >0.001 USD (simulated)',
    eta: '≈2 mins',
    icon: Gem,
    iconClassName: 'bg-blue-500/15 text-blue-400',
    demoAddress: '0xDe0f1A2b3C4d5E6f7890AbCdEf1234567890aBcD',
  },
] as const

type Step = 'form' | 'review' | 'success'

export default function DepositModal({ open, onClose, uid, email }: DepositModalProps) {
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
      await navigator.clipboard.writeText(gateway.demoAddress)
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
      await submitDepositRequest(uid, email, submittedAmount)
      setStep('success')
    } catch (err) {
      setError(err instanceof BalanceRequestError ? err.message : 'Could not submit deposit request — please try again.')
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
              Funds arrive to your virtual USD balance. Choose a simulated transfer gateway below.
            </p>
          </div>

          <div>
            <p className="text-center text-xs font-medium uppercase tracking-wide text-text-muted">
              Choose transfer gateway
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

          <p className="flex items-center gap-2 rounded-md border border-danger/30 bg-danger/10 px-3 py-2.5 text-xs text-danger">
            <ShieldAlert size={14} className="flex-none" />
            This is a demo address, not real.
          </p>

          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-text-muted">
              Demo deposit address ({gateway.id.toUpperCase()})
            </p>
            <div className="mt-2 flex items-center gap-2 rounded-md border border-border bg-surface-alt px-3 py-2.5">
              <span className="flex-1 truncate font-mono text-xs text-accent-gold">{gateway.demoAddress}</span>
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
            Status: Pending — this simulated request is reviewed by an admin before your balance
            updates. It is never credited automatically.
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
