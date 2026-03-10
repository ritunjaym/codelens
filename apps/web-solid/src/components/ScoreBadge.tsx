type Score = 'Critical' | 'Important' | 'Low'
export function ScoreBadge({ label }: { label: Score }) {
  const styles = {
    Critical: 'bg-[var(--critical-subtle)] text-[var(--critical)] border border-[var(--critical)]/30',
    Important: 'bg-[var(--important-subtle)] text-[var(--important)] border border-[var(--important)]/30',
    Low: 'bg-[var(--low)] text-[var(--low-text)] border border-[var(--border)]',
  }
  return (
    <span class={`mono text-[10px] font-medium px-1.5 py-0.5 rounded uppercase tracking-wider ${styles[label]}`}>
      {label}
    </span>
  )
}
