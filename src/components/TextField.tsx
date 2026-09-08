import type { InputHTMLAttributes } from 'react'

interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string
  error?: string
}

export default function TextField({ label, error, id, name, className = '', ...props }: TextFieldProps) {
  const inputId = id ?? name
  return (
    <div>
      <label htmlFor={inputId} className="block text-sm font-medium text-text-primary">
        {label}
      </label>
      <input
        id={inputId}
        name={name}
        className={`mt-1.5 w-full rounded-md border bg-surface-alt px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 ${
          error
            ? 'border-danger focus:border-danger focus:ring-danger'
            : 'border-border focus:border-accent-gold focus:ring-accent-gold'
        } ${className}`}
        aria-invalid={Boolean(error)}
        {...props}
      />
      {error && <p className="mt-1 text-xs text-danger">{error}</p>}
    </div>
  )
}
