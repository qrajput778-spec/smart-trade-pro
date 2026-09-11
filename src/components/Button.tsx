import type { ButtonHTMLAttributes } from 'react'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
}

const variantClasses: Record<NonNullable<ButtonProps['variant']>, string> = {
  primary: 'bg-accent-gold text-background hover:opacity-90',
  secondary: 'bg-surface-alt text-text-primary border border-border hover:border-accent-gold',
  ghost: 'bg-transparent text-text-muted hover:text-text-primary',
  // A real variant rather than a className override — Tailwind's cascade
  // order isn't guaranteed to match string concatenation order, so bolting
  // "text-danger" onto the secondary variant via className isn't reliable.
  danger: 'bg-danger text-white hover:opacity-90',
}

export default function Button({ variant = 'primary', className = '', ...props }: ButtonProps) {
  return (
    <button
      className={`px-4 py-2 rounded-md font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${variantClasses[variant]} ${className}`}
      {...props}
    />
  )
}
