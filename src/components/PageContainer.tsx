import type { HTMLAttributes } from 'react'

/**
 * Standard content wrapper for pages inside the authenticated sidebar shell.
 * Fills the width remaining next to the sidebar (no page should hand-roll
 * its own max-width here — that's what previously capped content at ~1152px
 * and left a large empty gap on wide/ultrawide monitors), but still caps out
 * at a sane width so lines don't stretch edge-to-edge on huge displays.
 */
export default function PageContainer({ className = '', ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={`mx-auto w-full max-w-[1800px] px-6 py-10 lg:px-10 ${className}`} {...props} />
  )
}
