import { useRef, type ChangeEvent } from 'react'
import { CheckCircle2, Upload, X, type LucideIcon } from 'lucide-react'
import Card from './Card'
import Button from './Button'

interface KycDocumentCardProps {
  title: string
  description: string
  icon: LucideIcon
  accept: string
  file: File | null
  onFileSelect: (file: File | null) => void
  error: string | null
  /** 0-100 while an upload is in flight for this file; null otherwise. */
  progress: number | null
  /** True once this file has been successfully uploaded as part of a submission. */
  uploaded?: boolean
  disabled?: boolean
  previewUrl?: string | null
  badge?: string
}

/**
 * One upload card in the KYC document grid (Kyc.tsx) — ID Card, Driving
 * License, Passport, and Upload Photo all render through this same
 * component, just with different icon/copy/accept props, so there is
 * exactly one upload-card implementation, not four near-duplicates.
 */
export default function KycDocumentCard({
  title,
  description,
  icon: Icon,
  accept,
  file,
  onFileSelect,
  error,
  progress,
  uploaded,
  disabled,
  previewUrl,
  badge,
}: KycDocumentCardProps) {
  const inputRef = useRef<HTMLInputElement>(null)

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    const nextFile = event.target.files?.[0] ?? null
    onFileSelect(nextFile)
    // Allow re-selecting the exact same file later (e.g. after clearing it).
    event.target.value = ''
  }

  return (
    <Card className={uploaded ? 'border-success/40' : undefined}>
      <div className="flex items-start gap-3">
        <span
          className={`flex h-10 w-10 flex-none items-center justify-center rounded-md ${
            uploaded ? 'bg-success/10 text-success' : 'bg-accent-gold-soft text-accent-gold'
          }`}
        >
          <Icon size={20} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-text-primary">{title}</h3>
            {badge && (
              <span className="rounded-full bg-surface-alt px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-text-muted">
                {badge}
              </span>
            )}
          </div>
          <p className="mt-0.5 text-xs text-text-muted">{description}</p>
        </div>
      </div>

      <input ref={inputRef} type="file" accept={accept} onChange={handleChange} className="hidden" disabled={disabled} />

      <div className="mt-4">
        {file ? (
          <div className="rounded-md border border-border bg-surface-alt px-3 py-2.5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2">
                {previewUrl ? (
                  <img src={previewUrl} alt="" className="h-8 w-8 flex-none rounded object-cover" />
                ) : (
                  <CheckCircle2 size={16} className="flex-none text-success" />
                )}
                <span className="truncate text-xs font-medium text-text-primary">{file.name}</span>
              </div>
              {!disabled && (
                <button
                  type="button"
                  onClick={() => onFileSelect(null)}
                  className="flex-none rounded p-1 text-text-muted transition-colors hover:bg-surface hover:text-danger"
                  aria-label={`Remove ${title}`}
                >
                  <X size={14} />
                </button>
              )}
            </div>

            {progress !== null && (
              <div className="mt-2">
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface">
                  <div className="h-full bg-accent-gold transition-all" style={{ width: `${progress}%` }} />
                </div>
                <p className="mt-1 text-[10px] text-text-muted">
                  {progress >= 100 ? 'Uploaded' : `Uploading… ${progress}%`}
                </p>
              </div>
            )}
            {progress === null && !disabled && (
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                className="mt-2 text-[11px] font-medium text-accent-gold hover:underline"
              >
                Replace file
              </button>
            )}
          </div>
        ) : (
          <Button
            type="button"
            variant="secondary"
            className="flex w-full items-center justify-center gap-2 text-xs"
            onClick={() => inputRef.current?.click()}
            disabled={disabled}
          >
            <Upload size={14} /> Choose File
          </Button>
        )}

        {error && <p className="mt-2 text-xs text-danger">{error}</p>}
      </div>
    </Card>
  )
}
