import { ErrorBoundary as SolidErrorBoundary } from 'solid-js'
import type { ParentProps } from 'solid-js'

interface Props extends ParentProps {
  fallback?: (err: Error, reset: () => void) => any
}

export function ErrorBoundary(props: Props) {
  return (
    <SolidErrorBoundary fallback={(err, reset) => (
      props.fallback?.(err, reset) ?? (
        <div class="flex flex-col items-center justify-center p-8 gap-4">
          <p class="text-[var(--critical)] text-sm">Something went wrong</p>
          <button
            onClick={() => window.location.reload()}
            class="text-xs px-3 py-1.5 bg-[var(--bg-elevated)] border border-[var(--border)] text-[var(--text-primary)] rounded hover:border-[var(--accent)] transition-colors"
          >
            Try Again
          </button>
        </div>
      )
    )}>
      {props.children}
    </SolidErrorBoundary>
  )
}
