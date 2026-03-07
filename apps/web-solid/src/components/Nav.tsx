import { session, logout } from '@/stores/session'
import { useNavigate } from '@tanstack/solid-router'
import { RateLimitBar } from './RateLimitBar'

export function Nav() {
  const navigate = useNavigate()

  return (
    <header class="border-b border-slate-800 bg-slate-900/50 backdrop-blur sticky top-0 z-50">
      <div class="max-w-7xl mx-auto px-4 h-14 flex items-center justify-between">
        <a href="/dashboard" class="font-bold text-white text-lg tracking-tight">
          CodeLens
        </a>
        <div class="flex items-center gap-4">
          <RateLimitBar />
          <div class="flex items-center gap-2">
            <img
              src={session()?.user.avatar_url}
              class="w-7 h-7 rounded-full"
              alt={session()?.user.login}
            />
            <span class="text-sm text-slate-300">{session()?.user.login}</span>
          </div>
          <button
            onClick={async () => { await logout(); navigate({ to: '/login' }) }}
            class="text-xs text-slate-400 hover:text-white transition-colors"
          >
            Sign out
          </button>
        </div>
      </div>
    </header>
  )
}
