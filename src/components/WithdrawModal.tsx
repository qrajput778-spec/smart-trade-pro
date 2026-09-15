import { useEffect, useState, type FormEvent } from 'react'
import { ArrowLeft, CheckCircle2, ShieldAlert } from 'lucide-react'
import Button from './Button'
import TextField from './TextField'
import Modal from './Modal'
import { formatUsd } from '../lib/constants'
import { BalanceRequestError, submitWithdrawalRequest } from '../lib/balanceRequests'

interface WithdrawModalProps {
  open: boolean
  onClose: () => void
  uid: string
  email: string
  balance: number
  pendingWithdrawalTotal: number
}

type Step = 'form' | 'review' | 'success'

/**
 * Recipient address is required and stored with the request so an admin has
 * the destination context while manually reviewing it (src/lib/balanceRequests.ts).
 * No fee is shown because the existing withdrawal logic does not charge one.
 */
export default function WithdrawModal({ open, onClose, uid, email, balance, pendingWithdrawalTotal }: WithdrawModalProps) {
  const [step, setStep] = useState<Step>('form')
  const [recipientAddress, setRecipientAddress] = useState('')
  const [amount, setAmount] = useState('')
  const [submittedAmount, setSubmittedAmount] = useState(0)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const availableToWithdraw = Math.max(0, balance - pendingWithdrawalTotal)

  useEffect(() => {
    if (open) {
      setStep('form')
      setRecipientAddress('')
      setAmount('')
      setError(null)
    }
  }, [open])

  function handleReview(event: FormEvent) {
    event.preventDefault()
    setError(null)

    if (!recipientAddress.trim()) {
      setError('Enter a recipient address or account reference.')
      return
    }

    const parsed = Number.parseFloat(amount)
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setError('Enter an amount greater than zero.')
      return
    }
    if (parsed > availableToWithdraw) {
      setError(`You can request up to ${formatUsd(availableToWithdraw)}.`)
      return
    }

    setSubmittedAmount(parsed)
    setStep('review')
  }

  async function handleConfirm() {
    setSubmitting(true)
    setError(null)
    try {
      await submitWithdrawalRequest(uid, email, submittedAmount, recipientAddress)
      setStep('success')
    } catch (err) {
      setError(
        err instanceof BalanceRequestError ? err.message : 'Could not submit withdrawal request — please try again.',
      )
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Withdraw">
      {step === 'form' && (
        <form onSubmit={handleReview} className="space-y-5" noValidate>
          <TextField
            label="Recipient address"
            name="recipientAddress"
            value={recipientAddress}
            onChange={(event) => setRecipientAddress(event.target.value)}
            placeholder="bc1q... or account number"
            autoFocus
          />

          <div>
            <TextField
              label="Amount (USD)"
              name="amount"
              type="number"
              min="0.01"
              max={availableToWithdraw || undefined}
              step="0.01"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              placeholder="0.00"
            />
            <p className="mt-1.5 flex items-center justify-between text-xs text-text-muted">
              <span>Available to withdraw</span>
              <span className="font-mono text-text-primary">{formatUsd(availableToWithdraw)}</span>
            </p>
            {pendingWithdrawalTotal > 0 && (
              <p className="mt-1 text-xs text-text-muted">
                {formatUsd(pendingWithdrawalTotal)} is already reserved by your other pending withdrawal requests.
              </p>
            )}
          </div>

          {error && <p className="text-xs text-danger">{error}</p>}

          <p className="flex items-start gap-2 rounded-md border border-border bg-surface-alt px-3 py-2.5 text-xs text-text-muted">
            <ShieldAlert size={14} className="mt-0.5 flex-none text-accent-gold" />
            Your balance is deducted only once an admin approves the request — never on submission.
          </p>

          <Button type="submit" className="w-full" disabled={availableToWithdraw <= 0}>
            Review Withdrawal
          </Button>
        </form>
      )}

      {step === 'review' && (
        <div className="space-y-5">
          <div className="rounded-lg border border-border bg-surface-alt p-4">
            <div className="flex items-center justify-between gap-3 text-sm">
              <span className="flex-none text-text-muted">Recipient</span>
              <span className="truncate font-mono text-xs text-text-primary" title={recipientAddress}>
                {recipientAddress}
              </span>
            </div>
            <div className="mt-2 flex items-center justify-between text-sm">
              <span className="text-text-muted">Amount</span>
              <span className="font-mono text-lg font-semibold text-text-primary">{formatUsd(submittedAmount)}</span>
            </div>
            <div className="mt-2 flex items-center justify-between text-sm">
              <span className="text-text-muted">Balance after approval</span>
              <span className="font-mono text-text-primary">{formatUsd(balance - submittedAmount)}</span>
            </div>
          </div>

          <p className="flex items-start gap-2 rounded-md border border-accent-gold/30 bg-accent-gold-soft px-3 py-2.5 text-xs text-text-primary">
            <ShieldAlert size={14} className="mt-0.5 flex-none text-accent-gold" />
            <span>
              <strong className="font-semibold">Withdrawal requests require admin review.</strong> Submitting
              creates a pending request and reserves this amount — your balance is deducted only once an
              admin approves it.
            </span>
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
              {submitting ? 'Submitting…' : 'Submit Withdrawal Request'}
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
            <p className="font-medium text-text-primary">Withdrawal request submitted</p>
            <p className="mt-1 text-sm text-text-muted">
              Your request for {formatUsd(submittedAmount)} is pending admin review. It's already reserved
              against your balance so it can't be double-spent while it waits.
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
