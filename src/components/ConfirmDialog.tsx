import { useEffect, useRef, useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import Button from './Button'
import Modal from './Modal'

interface ConfirmDialogProps {
  open: boolean
  onClose: () => void
  title: string
  description: string
  confirmLabel: string
  loadingLabel?: string
  onConfirm: () => void | Promise<void>
  variant?: 'primary' | 'danger'
}

/**
 * Shared confirmation prompt for actions that require an explicit user
 * decision. The action is invoked only from the Confirm button; while an
 * async action is pending, every dismissal route is disabled to prevent a
 * duplicate submission or an accidental close.
 */
export default function ConfirmDialog({
  open,
  onClose,
  title,
  description,
  confirmLabel,
  loadingLabel = 'Confirming…',
  onConfirm,
  variant = 'primary',
}: ConfirmDialogProps) {
  const [confirming, setConfirming] = useState(false)
  const cancelButtonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) {
      setConfirming(false)
      return
    }
    cancelButtonRef.current?.focus()
  }, [open])

  function handleClose() {
    if (!confirming) onClose()
  }

  async function handleConfirm() {
    if (confirming) return
    setConfirming(true)
    try {
      await onConfirm()
      onClose()
    } finally {
      setConfirming(false)
    }
  }

  return (
    <Modal open={open} onClose={handleClose} title={title}>
      <div className="space-y-5">
        <div className="flex gap-3">
          {variant === 'danger' && (
            <span className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-danger/10 text-danger">
              <AlertTriangle size={18} aria-hidden="true" />
            </span>
          )}
          <p className="pt-1 text-sm leading-6 text-text-muted">{description}</p>
        </div>

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button ref={cancelButtonRef} type="button" variant="secondary" onClick={handleClose} disabled={confirming}>
            Cancel
          </Button>
          <Button type="button" variant={variant} onClick={handleConfirm} disabled={confirming}>
            {confirming ? loadingLabel : confirmLabel}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
