import { createSignal, For, Show } from 'solid-js'
import { useNavigate } from '@tanstack/solid-router'
import { AuthGuard } from '@/components/AuthGuard'
import { Nav } from '@/components/Nav'
import { useRepos, usePRs } from '@/hooks/queries'
import { formatDistanceToNow } from 'date-fns'

function PRSkeleton() {
  return (
    <div class="space-y-2">
      {[...Array(5)].map(() => (
        <div class="h-20 bg-slate-800 rounded-lg animate-pulse" />
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
      <Nav />
      <main class="max-w-4xl mx-auto px-4 py-8">
        <div class="mb-6">
          <h1 class="text-2xl font-bold text-white mb-1">Dashboard</h1>
          <p class="text-slate-400 text-sm">Select a repository to review pull requests</p>
        </div>

        {/* Repo selector */}
        <div class="mb-6">
          <Show when={repos.isLoading}>
            <div class="h-10 bg-slate-800 rounded-lg animate-pulse w-72" />
          </Show>
          <Show when={repos.data}>
            <select
              class="bg-slate-800 border border-slate-700 text-slate-200 rounded-lg px-3 py-2 text-sm w-72 focus:outline-none focus:ring-2 focus:ring-blue-500"
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
              <div class="text-center py-16 text-slate-500">
                <p class="text-lg mb-2">No open pull requests</p>
                <p class="text-sm">Try selecting a different repository.</p>
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
                    <div
                      class="bg-slate-900 border border-slate-800 rounded-lg p-4 hover:border-slate-600 transition-colors cursor-pointer group"
                      onClick={() => navigate({ to: prUrl as any })}
                      onMouseEnter={() => handlePRHover(repoOwner, repoName, pr.number)}
                    >
                      <div class="flex items-start gap-3">
                        <img src={pr.user.avatar_url} class="w-8 h-8 rounded-full mt-0.5" />
                        <div class="flex-1 min-w-0">
                          <div class="flex items-center gap-2 flex-wrap">
                            <span class="text-white font-medium text-sm group-hover:text-blue-400 transition-colors truncate">
                              {pr.title}
                            </span>
                            <Show when={pr.draft}>
                              <span class="text-xs bg-slate-700 text-slate-400 px-1.5 py-0.5 rounded">Draft</span>
                            </Show>
                            <For each={pr.labels}>
                              {label => (
                                <span
                                  class="text-xs px-1.5 py-0.5 rounded"
                                  style={{ background: `#${label.color}20`, color: `#${label.color}` }}
                                >
                                  {label.name}
                                </span>
                              )}
                            </For>
                          </div>
                          <div class="flex items-center gap-3 mt-1 text-xs text-slate-500">
                            <span>#{pr.number} by {pr.user.login}</span>
                            <span>{formatDistanceToNow(new Date(pr.updated_at))} ago</span>
                            <span class="text-green-600">+{pr.additions}</span>
                            <span class="text-red-500">-{pr.deletions}</span>
                            <span>{pr.changed_files} files</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  )
                }}
              </For>
            </div>
          </Show>
        </Show>

        <Show when={!selectedRepo()}>
          <div class="text-center py-24 text-slate-600">
            <p class="text-5xl mb-4">🔍</p>
            <p class="text-lg">Select a repository above to get started</p>
          </div>
        </Show>
      </main>
    </AuthGuard>
  )
}
