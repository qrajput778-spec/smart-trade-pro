export default function MiniStat({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="rounded-md border border-border bg-surface-alt px-3 py-2">
      <p className="text-[10px] uppercase tracking-wide text-text-muted">{label}</p>
      {value === null ? (
        <div className="mt-1.5 h-4 w-16 animate-pulse rounded bg-surface" />
      ) : (
        <p className="mt-1 font-mono text-sm text-text-primary">{value}</p>
      )}
    </div>
  )
}
