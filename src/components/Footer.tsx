const footerLinkColumns = [
  {
    title: 'Product',
    links: ['Markets', 'Portfolio', 'Dashboard'],
  },
  {
    title: 'Resources',
    links: ['How it works', 'FAQ', 'Support'],
  },
]

export default function Footer() {
  return (
    <footer className="border-t border-border bg-surface">
      <div className="max-w-6xl mx-auto px-6 py-10 grid grid-cols-1 sm:grid-cols-3 gap-8">
        <div>
          <p className="text-sm font-semibold text-text-primary">
            SMART TRADE <span className="text-accent-gold">PRO</span>
          </p>
          <p className="mt-2 text-xs text-text-muted max-w-xs">
            A university course project. Paper-trading simulation only — every balance
            here is virtual.
          </p>
        </div>
        {footerLinkColumns.map((column) => (
          <div key={column.title}>
            <p className="text-xs font-semibold text-text-primary uppercase tracking-wide">
              {column.title}
            </p>
            <ul className="mt-3 space-y-2">
              {column.links.map((link) => (
                <li key={link} className="text-xs text-text-muted hover:text-text-primary transition-colors">
                  {link}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="border-t border-border px-6 py-4 text-center text-xs text-text-muted">
        SMART TRADE PRO — a university course project. Paper-trading simulation only, no
        real funds are ever moved.
      </div>
    </footer>
  )
}
