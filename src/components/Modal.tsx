import { useEffect, type ReactNode } from 'react'
import { X } from 'lucide-react'

interface ModalProps {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  /** Tailwind max-width class for the panel. Defaults to a compact modal width. */
  widthClassName?: string
}

/**
 * Generic modal shell — first one in the project (Topbar's account menu is
 * just an absolutely-positioned dropdown, not a true modal). Used by
 * DepositModal/WithdrawModal, but deliberately not specific to either:
 * backdrop + centered dark panel + title bar + Escape/backdrop-click to
 * close + body scroll lock while open. No portal needed — nothing in
 * Layout.tsx sets a `transform` on an ancestor, so `fixed` positioning here
 * reliably escapes the sidebar/topbar layout instead of being clipped by it.
 */
export default function Modal({ open, onClose, title, children, widthClassName = 'max-w-md' }: ModalProps) {
  useEffect(() => {
    if (!open) return

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKeyDown)

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.body.style.overflow = previousOverflow
    }
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0 animate-fade-in bg-black/70" onClick={onClose} aria-hidden="true" />

      <div
        className={`relative flex max-h-[85vh] w-full ${widthClassName} animate-scale-in flex-col rounded-xl border border-border bg-surface shadow-2xl`}
      >
        <div className="flex flex-none items-center justify-between border-b border-border px-5 py-4">
          <h2 className="text-base font-semibold text-text-primary">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-text-muted transition-colors hover:bg-surface-alt hover:text-text-primary"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        <div className="overflow-y-auto px-5 py-5">{children}</div>
      </div>
    </div>
  )
}
