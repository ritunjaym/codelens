import { logout, session } from '@/stores/session'
import { RateLimitBar } from './RateLimitBar'

export function Nav() {
  return (
    <header class="h-12 border-b border-[var(--border)] bg-[var(--bg-surface)] flex items-center px-4 gap-4 sticky top-0 z-40">
      <div class="flex items-center gap-2">
        <div class="w-6 h-6 rounded bg-[var(--accent)] flex items-center justify-center">
          <span class="text-white text-xs font-bold mono">CL</span>
        </div>
        <span class="font-semibold text-sm text-[var(--text-primary)] tracking-tight">CodeLens</span>
      </div>
      <div class="flex-1" />
      <RateLimitBar />
      <div class="flex items-center gap-3">
        <img
          src={session()?.user.avatar_url}
          class="w-6 h-6 rounded-full border border-[var(--border)]"
          alt={session()?.user.login}
        />
        <button
          onClick={logout}
          class="text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
        >
          Sign out
        </button>
      </div>
    </header>
  )
}
