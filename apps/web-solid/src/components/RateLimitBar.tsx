import { createSignal, onCleanup, Show } from 'solid-js'

interface RateLimit { remaining: number; limit: number; reset: number | null }

const [rateLimit, setRateLimit] = createSignal<RateLimit>({ remaining: 5000, limit: 5000, reset: null })

export function useRateLimitExhausted() {
  return () => rateLimit().remaining === 0
}

export function RateLimitBar() {
  async function fetchRateLimit() {
    const res = await fetch('/api/github/rate_limit')
    if (!res.ok) return
    const data = await res.json() as { rate: { remaining: number; limit: number; reset: number } }
    setRateLimit({ remaining: data.rate.remaining, limit: data.rate.limit, reset: data.rate.reset })
  }

  fetchRateLimit()
  const interval = setInterval(fetchRateLimit, 30_000)
  onCleanup(() => clearInterval(interval))

  const isWarning = () => rateLimit().remaining < 100 && rateLimit().remaining > 0
  const isExhausted = () => rateLimit().remaining === 0

  return (
    <Show when={rateLimit().remaining < 500}>
      <span class={`text-xs px-2 py-1 rounded ${
        isExhausted() ? 'bg-red-900/50 text-red-300' :
        isWarning() ? 'bg-yellow-900/50 text-yellow-300' :
        'text-slate-400'
      }`}>
        {isExhausted()
          ? `Rate limited · resets ${new Date((rateLimit().reset ?? 0) * 1000).toLocaleTimeString()}`
          : `API: ${rateLimit().remaining}/${rateLimit().limit}`
        }
      </span>
    </Show>
  )
}
