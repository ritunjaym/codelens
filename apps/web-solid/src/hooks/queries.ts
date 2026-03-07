import { createQuery } from '@tanstack/solid-query'
import { github } from '@/lib/github'

export const queryKeys = {
  repos: () => ['repos'] as const,
  prs: (owner: string, repo: string) => ['prs', owner, repo] as const,
  pr: (owner: string, repo: string, number: number) => ['pr', owner, repo, number] as const,
  prFiles: (owner: string, repo: string, number: number) => ['prFiles', owner, repo, number] as const,
  timeline: (owner: string, repo: string, number: number) => ['timeline', owner, repo, number] as const,
}

export function useRepos() {
  return createQuery(() => ({
    queryKey: queryKeys.repos(),
    queryFn: () => github.getRepos(),
    staleTime: 5 * 60_000,
  }))
}

export function usePRs(owner: () => string, repo: () => string) {
  return createQuery(() => ({
    queryKey: queryKeys.prs(owner(), repo()),
    queryFn: () => github.getPRs(owner(), repo()),
    enabled: !!(owner() && repo()),
    staleTime: 60_000,
  }))
}

export function usePR(owner: () => string, repo: () => string, number: () => number) {
  return createQuery(() => ({
    queryKey: queryKeys.pr(owner(), repo(), number()),
    queryFn: () => github.getPR(owner(), repo(), number()),
    staleTime: 30_000,
  }))
}

export function usePRFiles(owner: () => string, repo: () => string, number: () => number) {
  return createQuery(() => ({
    queryKey: queryKeys.prFiles(owner(), repo(), number()),
    queryFn: () => github.getPRFiles(owner(), repo(), number()),
    staleTime: 30_000,
  }))
}

export function useTimeline(owner: () => string, repo: () => string, number: () => number) {
  return createQuery(() => ({
    queryKey: queryKeys.timeline(owner(), repo(), number()),
    queryFn: async () => {
      const [events, reviews] = await Promise.all([
        github.getEvents(owner(), repo(), number()),
        github.getPRReviews(owner(), repo(), number()),
      ])
      return [...events, ...reviews].sort(
        (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      )
    },
    staleTime: 60_000,
  }))
}
