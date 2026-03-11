import { createSignal, createEffect, createMemo, Show, onCleanup } from 'solid-js'
import { useParams, useNavigate } from '@tanstack/solid-router'
import { AuthGuard } from '@/components/AuthGuard'
import { Nav } from '@/components/Nav'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { FileList } from '@/components/pr-review/FileList'
import { DiffViewer } from '@/components/pr-review/DiffViewer'
import { ClusterPanel } from '@/components/pr-review/ClusterPanel'
import { Timeline } from '@/components/pr-review/Timeline'
import { CommandPalette } from '@/components/CommandPalette'
import { KeyboardShortcutsModal } from '@/components/KeyboardShortcutsModal'
import { PresenceBar } from '@/components/PresenceBar'
import { useQueryClient } from '@tanstack/solid-query'
import { usePR, usePRFiles } from '@/hooks/queries'
import { usePartyKit } from '@/hooks/usePartyKit'
import { mlApi, type RankedFile, type Cluster } from '@/lib/ml'

export function PRReviewPage() {
  // useParams returns an Accessor in TanStack Router Solid — destructure once
  // (route params are stable for component lifetime; remount on navigation)
  const { owner, repo, number: prNumber } = useParams({ from: '/pr/$owner/$repo/$number' })()
  const navigate = useNavigate()

  const pr = usePR(
    () => owner,
    () => repo,
    () => parseInt(prNumber)
  )
  const files = usePRFiles(
    () => owner,
    () => repo,
    () => parseInt(prNumber)
  )

  const [selectedFile, setSelectedFile] = createSignal<string | null>(null)
  const [focusedIndex, setFocusedIndex] = createSignal(0)
  const [aiPriority, setAiPriority] = createSignal(true)
  const [selectedCluster, setSelectedCluster] = createSignal<string | null>(null)
  const [rankedFiles, setRankedFiles] = createSignal<RankedFile[]>([])
  const [clusters, setClusters] = createSignal<Cluster[]>([])
  const [mlLoading, setMlLoading] = createSignal(false)
  const [processingMs, setProcessingMs] = createSignal<number | null>(null)
  const [showPalette, setShowPalette] = createSignal(false)
  const [showShortcuts, setShowShortcuts] = createSignal(false)
  const [commentOpen, setCommentOpen] = createSignal(false)
  const [bannerDismissed, setBannerDismissed] = createSignal(false)
  const [activeTab, setActiveTab] = createSignal<'clusters' | 'timeline'>('clusters')
  const [showMobileFiles, setShowMobileFiles] = createSignal(false)

  // Invalidate queries on incoming GitHub webhook events
  const queryClient = useQueryClient()
  const { lastGithubEvent } = usePartyKit(`${owner}/${repo}/${prNumber}`)
  createEffect(() => {
    const ev = lastGithubEvent()
    if (!ev) return
    const num = parseInt(prNumber)
    queryClient.invalidateQueries({ queryKey: ['pr', owner, repo, num] })
    queryClient.invalidateQueries({ queryKey: ['prFiles', owner, repo, num] })
    queryClient.invalidateQueries({ queryKey: ['timeline', owner, repo, num] })
  })

  // Run ML ranking when files load
  createEffect(async () => {
    const fileData = files.data
    if (!fileData || fileData.length === 0) return
    setMlLoading(true)
    try {
      const [rankResult, clusterResult] = await Promise.all([
        mlApi.rankFiles(
          `${owner}/${repo}/${prNumber}`,
          `${owner}/${repo}`,
          fileData.map(f => ({ filename: f.filename, patch: f.patch, additions: f.additions, deletions: f.deletions }))
        ),
        mlApi.clusterFiles(
          `${owner}/${repo}/${prNumber}`,
          fileData.map(f => ({ filename: f.filename, patch: f.patch }))
        ),
      ])
      setRankedFiles(rankResult.ranked)
      setProcessingMs(rankResult.processing_ms)
      setClusters(clusterResult)
    } finally {
      setMlLoading(false)
    }
  })

  // Auto-select first file
  createEffect(() => {
    if (files.data && files.data.length > 0 && !selectedFile()) {
      setSelectedFile(files.data[0].filename)
    }
  })

  const fileNames = createMemo(() => files.data?.map(f => f.filename) ?? [])
  const focusedFile = createMemo(() => fileNames()[focusedIndex()] ?? null)

  const criticalFiles = createMemo(() =>
    rankedFiles().filter(f => f.label === 'Critical').map(f => f.filename)
  )

  const clusterFileMap = createMemo(() => {
    const map: Record<string, string> = {}
    if (selectedCluster()) {
      const cluster = clusters().find(c => c.id === selectedCluster())
      cluster?.files.forEach(f => { map[f] = cluster.color })
    }
    return map
  })

  const selectedFileData = createMemo(() =>
    files.data?.find(f => f.filename === selectedFile()) ?? null
  )
  const selectedFileRank = createMemo(() =>
    rankedFiles().find(r => r.filename === selectedFile()) ?? null
  )

  function handleMobileFileSelect(filename: string) {
    setSelectedFile(filename)
    setShowMobileFiles(false)
  }

  // Keyboard shortcuts
  createEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement).isContentEditable) return

      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault(); setShowPalette(true)
      } else if (e.key === '?') {
        e.preventDefault(); setShowShortcuts(true)
      } else if (e.key === 'j') {
        e.preventDefault()
        setFocusedIndex(i => {
          const next = Math.min(fileNames().length - 1, i + 1)
          setSelectedFile(fileNames()[next])
          return next
        })
      } else if (e.key === 'k') {
        e.preventDefault()
        setFocusedIndex(i => {
          const next = Math.max(0, i - 1)
          setSelectedFile(fileNames()[next])
          return next
        })
      } else if (e.key === 'c') {
        e.preventDefault(); setCommentOpen(true)
      } else if (e.key === 'o') {
        e.preventDefault(); setAiPriority(p => !p)
      }
    }

    // g→d sequence
    let pendingG = false
    let gTimer: ReturnType<typeof setTimeout> | null = null
    const gHandler = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === 'INPUT') return
      if (e.key === 'g') { pendingG = true; gTimer = setTimeout(() => { pendingG = false }, 1000) }
      else if (e.key === 'd' && pendingG) { pendingG = false; navigate({ to: '/dashboard' }) }
    }

    window.addEventListener('keydown', handler)
    window.addEventListener('keydown', gHandler)
    onCleanup(() => {
      window.removeEventListener('keydown', handler)
      window.removeEventListener('keydown', gHandler)
      if (gTimer) clearTimeout(gTimer)
    })
  })

  return (
    <AuthGuard>
      <div class="h-screen flex flex-col bg-[var(--bg-base)]">
        <Nav />
        <ErrorBoundary>
          {/* PR header bar */}
          <div class="border-b border-[var(--border)] bg-[var(--bg-surface)] px-4 py-2.5 flex items-center gap-3">
            <Show when={pr.data}>
              <span class="mono text-xs text-[var(--text-muted)]">#{pr.data?.number}</span>
              <span class="text-sm font-semibold text-[var(--text-primary)] truncate flex-1">{pr.data?.title}</span>
            </Show>
            <Show when={!pr.data}>
              <span class="flex-1" />
            </Show>
            <PresenceBar prId={`${owner}/${repo}/${prNumber}`} />
            <Show when={processingMs() !== null}>
              <span class="mono text-[10px] text-[var(--accent)] bg-[var(--accent-subtle)] px-2 py-0.5 rounded border border-[var(--accent)]/20">
                AI {processingMs()! < 50 ? '< 50' : processingMs()}ms
              </span>
            </Show>
            <button
              class={`text-xs px-3 py-1.5 rounded border transition-colors mono ${
                aiPriority()
                  ? 'bg-[var(--accent-subtle)] border-[var(--accent)]/30 text-[var(--accent)]'
                  : 'border-[var(--border)] text-[var(--text-secondary)] hover:border-[var(--border)]'
              }`}
              onClick={() => setAiPriority(p => !p)}
            >
              {aiPriority() ? 'AI Priority' : 'Default Order'}
            </button>
          </div>

          {/* Critical files banner */}
          <Show when={aiPriority() && criticalFiles().length > 0 && !bannerDismissed()}>
            <div class="border-b border-[var(--critical)]/20 bg-[var(--critical-subtle)] px-4 py-2 flex items-center gap-2">
              <span class="text-[var(--critical)] text-xs">
                {criticalFiles().length} critical file(s) need review:{' '}
                <span class="font-medium mono">{criticalFiles().slice(0, 3).join(', ')}</span>
                {criticalFiles().length > 3 && ` +${criticalFiles().length - 3} more`}
              </span>
              <button
                class="ml-auto text-[var(--critical)]/60 hover:text-[var(--critical)] text-xs transition-colors"
                onClick={() => setBannerDismissed(true)}
              >✕</button>
            </div>
          </Show>

          {/* Main 3-column layout */}
          <div class="flex-1 flex overflow-hidden">
            {/* Left: file list */}
            <div class="w-72 shrink-0 border-r border-[var(--border)] bg-[var(--bg-surface)] flex-col overflow-hidden hidden md:flex">
              <div class="px-3 py-2 border-b border-[var(--border)] flex items-center justify-between">
                <span class="text-xs text-[var(--text-secondary)] font-medium">Files</span>
                <span class="mono text-xs text-[var(--text-muted)]">{files.data?.length ?? 0}</span>
              </div>
              <div class="flex-1 overflow-y-auto">
                <Show when={files.isLoading}>
                  <div class="p-3 space-y-1">
                    {[...Array(8)].map(() => (
                      <div class="h-9 bg-[var(--bg-elevated)] rounded animate-pulse" />
                    ))}
                  </div>
                </Show>
                <Show when={files.data}>
                  <FileList
                    files={files.data!}
                    rankedFiles={rankedFiles()}
                    selectedFile={selectedFile()}
                    focusedFile={focusedFile()}
                    selectedCluster={selectedCluster()}
                    clusterFileMap={clusterFileMap()}
                    aiPriority={aiPriority()}
                    onSelectFile={setSelectedFile}
                  />
                </Show>
              </div>
            </div>

            {/* Center: diff viewer */}
            <div class="flex-1 overflow-y-auto bg-[var(--bg-base)]">
              <Show when={selectedFileData()} fallback={
                <div class="flex items-center justify-center h-full text-[var(--text-muted)]">
                  <p class="text-sm">Select a file to review</p>
                </div>
              }>
                <DiffViewer
                  file={selectedFileData()}
                  rank={selectedFileRank()}
                  prId={prNumber}
                  owner={owner}
                  repo={repo}
                  commentOpen={commentOpen()}
                  onCommentClose={() => setCommentOpen(false)}
                />
              </Show>
            </div>

            {/* Right: tabbed panel (clusters / timeline) */}
            <div class="w-64 shrink-0 border-l border-[var(--border)] bg-[var(--bg-surface)] flex flex-col overflow-hidden hidden lg:flex">
              <div class="flex border-b border-[var(--border)]">
                <button
                  class={`flex-1 text-xs py-2 transition-colors ${
                    activeTab() === 'clusters'
                      ? 'text-[var(--text-primary)] border-b-2 border-[var(--accent)]'
                      : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                  }`}
                  onClick={() => setActiveTab('clusters')}
                >
                  Groups
                </button>
                <button
                  class={`flex-1 text-xs py-2 transition-colors ${
                    activeTab() === 'timeline'
                      ? 'text-[var(--text-primary)] border-b-2 border-[var(--accent)]'
                      : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                  }`}
                  onClick={() => setActiveTab('timeline')}
                >
                  Timeline
                </button>
              </div>
              <div class="flex-1 overflow-y-auto p-3">
                <Show when={activeTab() === 'clusters'}>
                  <ClusterPanel
                    clusters={clusters()}
                    selectedCluster={selectedCluster()}
                    onSelectCluster={setSelectedCluster}
                    isLoading={mlLoading()}
                  />
                </Show>
                <Show when={activeTab() === 'timeline'}>
                  <Timeline
                    owner={owner}
                    repo={repo}
                    number={parseInt(prNumber)}
                  />
                </Show>
              </div>
            </div>
          </div>

          {/* Mobile floating file button */}
          <button
            class="fixed bottom-12 left-4 z-40 md:hidden bg-[var(--bg-elevated)] border border-[var(--border)] text-[var(--text-secondary)] text-sm px-3 py-2 rounded-full shadow-lg"
            onClick={() => setShowMobileFiles(true)}
          >
            Files
          </button>

          {/* Mobile file bottom sheet */}
          <Show when={showMobileFiles()}>
            <div
              class="fixed inset-0 z-50 md:hidden bg-black/50"
              onClick={() => setShowMobileFiles(false)}
            />
            <div class="fixed bottom-0 left-0 right-0 z-50 md:hidden bg-[var(--bg-surface)] border-t border-[var(--border)] max-h-[70vh] overflow-y-auto rounded-t-xl">
              <div class="flex items-center justify-between px-4 py-3 border-b border-[var(--border)] sticky top-0 bg-[var(--bg-surface)]">
                <span class="text-sm font-medium text-[var(--text-primary)]">Files ({files.data?.length ?? 0})</span>
                <button class="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors" onClick={() => setShowMobileFiles(false)}>✕</button>
              </div>
              <Show when={files.data}>
                <FileList
                  files={files.data!}
                  rankedFiles={rankedFiles()}
                  selectedFile={selectedFile()}
                  focusedFile={focusedFile()}
                  selectedCluster={selectedCluster()}
                  clusterFileMap={clusterFileMap()}
                  aiPriority={aiPriority()}
                  onSelectFile={handleMobileFileSelect}
                />
              </Show>
            </div>
          </Show>

          {/* Bottom keyboard hints */}
          <div class="fixed bottom-0 left-0 right-0 z-40 bg-[var(--bg-surface)]/90 backdrop-blur border-t border-[var(--border)] px-4 py-1.5 gap-4 text-xs text-[var(--text-muted)] hidden md:flex">
            <span><kbd class="bg-[var(--bg-elevated)] border border-[var(--border)] px-1 py-0.5 rounded mono text-[10px]">j</kbd>/<kbd class="bg-[var(--bg-elevated)] border border-[var(--border)] px-1 py-0.5 rounded mono text-[10px]">k</kbd> navigate</span>
            <span><kbd class="bg-[var(--bg-elevated)] border border-[var(--border)] px-1 py-0.5 rounded mono text-[10px]">c</kbd> comment</span>
            <span><kbd class="bg-[var(--bg-elevated)] border border-[var(--border)] px-1 py-0.5 rounded mono text-[10px]">o</kbd> toggle AI</span>
            <span><kbd class="bg-[var(--bg-elevated)] border border-[var(--border)] px-1 py-0.5 rounded mono text-[10px]">⌘K</kbd> search</span>
            <span><kbd class="bg-[var(--bg-elevated)] border border-[var(--border)] px-1 py-0.5 rounded mono text-[10px]">?</kbd> shortcuts</span>
            <span><kbd class="bg-[var(--bg-elevated)] border border-[var(--border)] px-1 py-0.5 rounded mono text-[10px]">gd</kbd> dashboard</span>
          </div>
        </ErrorBoundary>

        <CommandPalette
          open={showPalette()}
          onClose={() => setShowPalette(false)}
          files={files.data ?? []}
          rankedFiles={rankedFiles()}
          clusters={clusters()}
          onSelectFile={setSelectedFile}
          onSelectCluster={setSelectedCluster}
        />
        <KeyboardShortcutsModal
          open={showShortcuts()}
          onClose={() => setShowShortcuts(false)}
        />
      </div>
    </AuthGuard>
  )
}
