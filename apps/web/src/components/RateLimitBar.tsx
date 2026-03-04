"use client"

import useSWR from "swr"

interface RateLimitData {
  remaining: number
  limit: number
  reset: number | null
}

const fetcher = (url: string) => fetch(url).then(r => r.json())

export function useRateLimitExhausted(): boolean {
  const { data } = useSWR<RateLimitData>("/api/github/ratelimit", fetcher, { refreshInterval: 30000 })
  return data?.remaining === 0
}

export function RateLimitBar() {
  const { data } = useSWR<RateLimitData>("/api/github/ratelimit", fetcher, { refreshInterval: 30000 })

  if (!data) return null

  const { remaining, limit, reset } = data

  if (remaining === 0) {
    const resetTime = reset ? new Date(reset * 1000).toLocaleTimeString() : "soon"
    return (
      <span className="text-xs px-2 py-0.5 rounded-full bg-red-500/20 text-red-400 border border-red-500/40">
        Rate limited · resets {resetTime}
      </span>
    )
  }

  if (remaining < 100) {
    return (
      <span className="text-xs px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-400 border border-amber-500/40">
        GitHub API: {remaining}/{limit}
      </span>
    )
  }

  return (
    <span className="text-xs text-muted-foreground">
      GitHub API: {remaining}/{limit}
    </span>
  )
}
