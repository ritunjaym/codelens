import { createSignal, For, Show } from 'solid-js'
import { useNavigate } from '@tanstack/solid-router'
import { AuthGuard } from '@/components/AuthGuard'
import { Nav } from '@/components/Nav'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { useRepos, usePRs } from '@/hooks/queries'
import { formatDistanceToNow } from 'date-fns'

function PRSkeleton() {
  return (
    <div class="space-y-2">
      {[...Array(5)].map(() => (
        <div class="h-16 bg-[var(--bg-elevated)] rounded-lg animate-pulse" />
      ))}
    </div>
  )
}

export function DashboardPage() {
  const navigate = useNavigate()
  const [selectedRepo, setSelectedRepo] = createSignal('')

  const repos = useRepos()

  const prs = usePRs(
    () => selectedRepo().split('/')[0] ?? '',
    () => selectedRepo().split('/')[1] ?? ''
  )

  const prefetched = new Set<string>()
  function handlePRHover(owner: string, repo: string, number: number) {
    const key = `${owner}/${repo}/${number}`
    if (!prefetched.has(key)) {
      prefetched.add(key)
      fetch(`/api/github/repos/${owner}/${repo}/pulls/${number}/files?per_page=100`)
    }
  }

  return (
    <AuthGuard>
      <div class="min-h-screen bg-[var(--bg-base)]">
        <Nav />
        <ErrorBoundary>
          <main class="max-w-4xl mx-auto px-6 py-8">
            <div class="mb-6">
              <h1 class="text-lg font-semibold text-[var(--text-primary)]">Pull Requests</h1>
              <p class="text-[var(--text-secondary)] text-sm mt-0.5">Select a repository to review pull requests</p>
            </div>

            {/* Repo selector */}
            <div class="mb-6">
              <Show when={repos.isLoading}>
                <div class="h-9 bg-[var(--bg-elevated)] rounded-md animate-pulse w-64" />
              </Show>
              <Show when={repos.data}>
                <select
                  class="bg-[var(--bg-elevated)] border border-[var(--border)] text-[var(--text-primary)] text-sm rounded-md px-3 py-2 w-64 focus:outline-none focus:border-[var(--accent)] transition-colors"
                  value={selectedRepo()}
                  onChange={e => setSelectedRepo(e.currentTarget.value)}
                >
                  <option value="">Select a repository...</option>
                  <For each={repos.data}>
                    {repo => (
                      <option value={repo.full_name}>{repo.full_name}</option>
                    )}
                  </For>
                </select>
              </Show>
            </div>

            {/* PR list */}
            <Show when={selectedRepo()}>
              <Show when={prs.isLoading} fallback={
                <Show when={prs.data?.length === 0}>
                  <div class="text-center py-16 text-[var(--text-muted)]">
                    <p class="text-base mb-1">No open pull requests</p>
                    <p class="text-sm text-[var(--text-muted)]">Try selecting a different repository.</p>
                  </div>
                </Show>
              }>
                <PRSkeleton />
              </Show>

              <Show when={prs.data && prs.data.length > 0}>
                <div class="space-y-2">
                  <For each={prs.data}>
                    {pr => {
                      const [repoOwner, repoName] = selectedRepo().split('/')
                      const prUrl = `/pr/${repoOwner}/${repoName}/${pr.number}`
                      return (
                        <a
                          class="block bg-[var(--bg-surface)] border border-[var(--border)] rounded-lg px-4 py-3 hover:border-[var(--accent)]/50 hover:bg-[var(--bg-elevated)] transition-all cursor-pointer group"
                          onClick={() => navigate({ to: prUrl as any })}
                          onMouseEnter={() => handlePRHover(repoOwner, repoName, pr.number)}
                        >
                          <div class="flex items-start gap-3">
                            <div class="flex-1 min-w-0">
                              <div class="flex items-center gap-2 flex-wrap">
                                <span class="mono text-xs text-[var(--text-muted)]">#{pr.number}</span>
                                <span class="text-sm font-medium text-[var(--text-primary)] truncate group-hover:text-[var(--accent)] transition-colors">
                                  {pr.title}
                                </span>
                                <Show when={pr.draft}>
                                  <span class="text-[10px] px-1.5 py-0.5 rounded border border-[var(--border)] text-[var(--text-muted)] mono">Draft</span>
                                </Show>
                                <For each={pr.labels}>
                                  {label => (
                                    <span class="text-[10px] px-1.5 py-0.5 rounded border border-[var(--border)] text-[var(--text-muted)] mono">
                                      {label.name}
                                    </span>
                                  )}
                                </For>
                              </div>
                              <div class="flex items-center gap-3 mt-1.5 text-xs text-[var(--text-secondary)]">
                                <span>by {pr.user.login}</span>
                                <span>{formatDistanceToNow(new Date(pr.updated_at))} ago</span>
                                <span class="text-[var(--success)]">+{pr.additions}</span>
                                <span class="text-[var(--critical)]">-{pr.deletions}</span>
                                <span>{pr.changed_files} files</span>
                              </div>
                            </div>
                          </div>
                        </a>
                      )
                    }}
                  </For>
                </div>
              </Show>
            </Show>

            <Show when={!selectedRepo()}>
              <div class="text-center py-24 text-[var(--text-muted)]">
                <p class="text-base">Select a repository above to get started</p>
              </div>
            </Show>
          </main>
        </ErrorBoundary>
      </div>
    </AuthGuard>
  )
}
