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
import { usePR, usePRFiles } from '@/hooks/queries'
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
      <Nav />
      <ErrorBoundary>
        <div class="flex flex-col h-[calc(100vh-3.5rem)]">
          {/* PR header */}
          <div class="border-b border-slate-800 px-4 py-3 bg-slate-900/50 flex items-center gap-3">
            <Show when={pr.data}>
              <div class="flex-1 min-w-0">
                <h1 class="text-sm font-medium text-white truncate">{pr.data?.title}</h1>
                <p class="text-xs text-slate-500">
                  #{pr.data?.number} · {owner}/{repo}
                </p>
              </div>
            </Show>
            <PresenceBar prId={`${owner}/${repo}/${prNumber}`} />
            <button
              class={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${
                aiPriority()
                  ? 'bg-blue-600/20 border-blue-500 text-blue-300'
                  : 'border-slate-700 text-slate-400 hover:border-slate-600'
              }`}
              onClick={() => setAiPriority(p => !p)}
            >
              {aiPriority() ? '✦ AI Priority' : 'Default Order'}
            </button>
          </div>

          {/* Critical files banner */}
          <Show when={aiPriority() && criticalFiles().length > 0 && !bannerDismissed()}>
            <div class="bg-blue-950/50 border-b border-blue-800 px-4 py-2 flex items-center gap-2">
              <span class="text-blue-300 text-xs">
                ✦ AI recommends reviewing these {criticalFiles().length} file(s) first:{' '}
                <span class="font-medium">{criticalFiles().slice(0, 3).join(', ')}</span>
                {criticalFiles().length > 3 && ` +${criticalFiles().length - 3} more`}
              </span>
              <button
                class="ml-auto text-blue-500 hover:text-blue-300 text-xs"
                onClick={() => setBannerDismissed(true)}
              >✕</button>
            </div>
          </Show>

          {/* Main 3-column layout */}
          <div class="flex flex-1 min-h-0">
            {/* Left: file list — hidden on mobile */}
            <div class="w-72 border-r border-slate-800 flex-col min-h-0 shrink-0 hidden md:flex">
              <div class="px-3 py-2 border-b border-slate-800 flex items-center justify-between">
                <span class="text-xs text-slate-400">
                  {files.data?.length ?? 0} files
                </span>
                <Show when={processingMs() !== null}>
                  <span class="text-xs text-slate-600">
                    AI ranked in {processingMs()! < 50 ? '< 50' : processingMs()}ms
                  </span>
                </Show>
              </div>
              <Show when={files.isLoading}>
                <div class="p-3 space-y-1">
                  {[...Array(8)].map(() => (
                    <div class="h-9 bg-slate-800 rounded animate-pulse" />
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

            {/* Center: diff viewer */}
            <div class="flex-1 min-w-0 min-h-0 overflow-hidden">
              <DiffViewer
                file={selectedFileData()}
                rank={selectedFileRank()}
                prId={prNumber}
                owner={owner}
                repo={repo}
                commentOpen={commentOpen()}
                onCommentClose={() => setCommentOpen(false)}
              />
            </div>

            {/* Right: tabbed panel (clusters / timeline) */}
            <div class="w-56 border-l border-slate-800 flex flex-col min-h-0 shrink-0 hidden lg:flex">
              <div class="flex border-b border-slate-800">
                <button
                  class={`flex-1 text-xs py-2 transition-colors ${
                    activeTab() === 'clusters'
                      ? 'text-white border-b-2 border-blue-500'
                      : 'text-slate-500 hover:text-slate-300'
                  }`}
                  onClick={() => setActiveTab('clusters')}
                >
                  Groups
                </button>
                <button
                  class={`flex-1 text-xs py-2 transition-colors ${
                    activeTab() === 'timeline'
                      ? 'text-white border-b-2 border-blue-500'
                      : 'text-slate-500 hover:text-slate-300'
                  }`}
                  onClick={() => setActiveTab('timeline')}
                >
                  Timeline
                </button>
              </div>
              <div class="flex-1 overflow-y-auto">
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
            class="fixed bottom-12 left-4 z-40 md:hidden bg-slate-800 border border-slate-600 text-slate-200 text-sm px-3 py-2 rounded-full shadow-lg"
            onClick={() => setShowMobileFiles(true)}
          >
            📂 Files
          </button>

          {/* Mobile file bottom sheet */}
          <Show when={showMobileFiles()}>
            <div
              class="fixed inset-0 z-50 md:hidden bg-black/50"
              onClick={() => setShowMobileFiles(false)}
            />
            <div class="fixed bottom-0 left-0 right-0 z-50 md:hidden bg-slate-900 border-t border-slate-700 max-h-[70vh] overflow-y-auto rounded-t-xl">
              <div class="flex items-center justify-between px-4 py-3 border-b border-slate-800 sticky top-0 bg-slate-900">
                <span class="text-sm font-medium text-white">Files ({files.data?.length ?? 0})</span>
                <button class="text-slate-500 hover:text-white" onClick={() => setShowMobileFiles(false)}>✕</button>
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
          <div class="fixed bottom-0 left-0 right-0 z-40 bg-slate-950/90 backdrop-blur border-t border-slate-800 px-4 py-1.5 gap-4 text-xs text-slate-600 hidden md:flex">
            <span><kbd class="bg-slate-800 px-1 rounded font-mono">j</kbd>/<kbd class="bg-slate-800 px-1 rounded font-mono">k</kbd> navigate</span>
            <span><kbd class="bg-slate-800 px-1 rounded font-mono">c</kbd> comment</span>
            <span><kbd class="bg-slate-800 px-1 rounded font-mono">o</kbd> toggle AI</span>
            <span><kbd class="bg-slate-800 px-1 rounded font-mono">⌘K</kbd> search</span>
            <span><kbd class="bg-slate-800 px-1 rounded font-mono">?</kbd> shortcuts</span>
            <span><kbd class="bg-slate-800 px-1 rounded font-mono">gd</kbd> dashboard</span>
          </div>
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
    </AuthGuard>
  )
}
