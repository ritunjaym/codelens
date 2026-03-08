/**
 * CodeLens — Solid.js frontend
 *
 * Checklist:
 * ✅ Solid.js fine-grained reactivity (createSignal, createEffect, createMemo)
 * ✅ TanStack Router (file-based routes: /, /dashboard, /pr/:owner/:repo/:number)
 * ✅ TanStack Query (useRepos, usePRs, usePR, usePRFiles, useTimeline)
 * ✅ TanStack Virtual (FileList with createVirtualizer for 500+ files)
 * ✅ TailwindCSS (no other CSS framework)
 * ✅ Keyboard-first (j/k/c/o/⌘K/?/gd shortcuts)
 * ✅ GitHub OAuth (Vercel serverless functions)
 * ✅ Posts comments back to GitHub API
 * ✅ Webhook endpoint (api/webhooks/github)
 * ✅ Rate limit display + backoff
 * ✅ PartyKit WebSocket presence
 * ✅ Optimistic updates + retry with backoff
 * ✅ Connection status (Live/Offline)
 * ✅ ML integration (rank + cluster + graceful fallback)
 * ✅ Critical/Important/Low labels
 * ✅ "Review these N files first" banner
 * ✅ Semantic group cluster highlighting
 * ✅ ML inference latency display
 * ✅ Error boundaries
 * ✅ web-vitals
 * ✅ Vitest component tests
 * ✅ Mobile responsive (bottom sheet for file list)
 * ✅ Skeleton loading states
 * ✅ Empty states with helpful messages
 * ✅ Prefetch on hover
 * ✅ Stale-while-revalidate (TanStack Query default)
 * ✅ Code splitting (Vite automatic)
 */
import { render } from 'solid-js/web'
import { RouterProvider } from '@tanstack/solid-router'
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query'
import { router } from './router'
import { reportWebVitals } from './lib/vitals'
import './index.css'

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 60_000 } }
})

render(() => (
  <QueryClientProvider client={queryClient}>
    <RouterProvider router={router} />
  </QueryClientProvider>
), document.getElementById('root')!)

reportWebVitals()
