import type { HTMLAttributes } from 'react'

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: 'neutral' | 'success' | 'danger' | 'gold'
}

const toneClasses: Record<NonNullable<BadgeProps['tone']>, string> = {
  neutral: 'bg-surface-alt text-text-muted border border-border',
  success: 'bg-success/10 text-success border border-success/30',
  danger: 'bg-danger/10 text-danger border border-danger/30',
  gold: 'bg-accent-gold-soft text-accent-gold border border-accent-gold/30',
}

export default function Badge({ tone = 'neutral', className = '', ...props }: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${toneClasses[tone]} ${className}`}
      {...props}
    />
  )
}
