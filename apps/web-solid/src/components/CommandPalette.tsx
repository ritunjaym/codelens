import { createSignal, createMemo, For, Show, createEffect, onCleanup } from 'solid-js'
import type { PRFile } from '@/lib/github'
import type { RankedFile, Cluster } from '@/lib/ml'
import { ScoreBadge } from './ScoreBadge'
import { Portal } from 'solid-js/web'

interface Props {
  open: boolean
  onClose: () => void
  files: PRFile[]
  rankedFiles: RankedFile[]
  clusters: Cluster[]
  onSelectFile: (filename: string) => void
  onSelectCluster: (id: string | null) => void
}

export function CommandPalette(props: Props) {
  const [query, setQuery] = createSignal('')

  const rankMap = createMemo(() =>
    new Map(props.rankedFiles.map(r => [r.filename, r]))
  )

  const filteredFiles = createMemo(() => {
    const q = query().toLowerCase()
    if (!q) return props.files.slice(0, 10)
    return props.files.filter(f => f.filename.toLowerCase().includes(q)).slice(0, 10)
  })

  const filteredClusters = createMemo(() => {
    const q = query().toLowerCase()
    if (!q) return props.clusters
    return props.clusters.filter(c => c.label.toLowerCase().includes(q))
  })

  createEffect(() => {
    if (!props.open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') props.onClose()
    }
    window.addEventListener('keydown', handler)
    onCleanup(() => window.removeEventListener('keydown', handler))
  })

  return (
    <Show when={props.open}>
      <Portal>
        <div
          class="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-start justify-center pt-24"
          onClick={props.onClose}
        >
          <div
            class="w-full max-w-xl bg-slate-800 rounded-xl border border-slate-600 shadow-2xl overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            <div class="flex items-center gap-3 p-3 border-b border-slate-700">
              <svg class="w-4 h-4 text-slate-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/>
              </svg>
              <input
                type="text"
                class="flex-1 bg-transparent text-slate-200 text-sm placeholder-slate-500 outline-none"
                placeholder="Search files, clusters..."
                value={query()}
                onInput={e => setQuery(e.currentTarget.value)}
                autofocus
              />
              <span class="text-xs text-slate-500 shrink-0">ESC to close</span>
            </div>

            <div class="max-h-80 overflow-y-auto p-1">
              <Show when={filteredClusters().length > 0}>
                <div class="px-3 py-1 text-xs text-slate-500 uppercase tracking-wider">Clusters</div>
                <For each={filteredClusters()}>
                  {cluster => (
                    <button
                      class="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-slate-700 transition-colors text-left"
                      onClick={() => { props.onSelectCluster(cluster.id); props.onClose() }}
                    >
                      <div class="w-2 h-2 rounded-full shrink-0" style={{ background: cluster.color }} />
                      <span class="text-sm text-slate-200">{cluster.label}</span>
                      <span class="ml-auto text-xs text-slate-500">{cluster.files.length} files</span>
                    </button>
                  )}
                </For>
              </Show>

              <Show when={filteredFiles().length > 0}>
                <div class="px-3 py-1 text-xs text-slate-500 uppercase tracking-wider mt-1">Files</div>
                <For each={filteredFiles()}>
                  {file => {
                    const rank = () => rankMap().get(file.filename)
                    return (
                      <button
                        class="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-slate-700 transition-colors text-left"
                        onClick={() => { props.onSelectFile(file.filename); props.onClose() }}
                      >
                        <span class="text-sm text-slate-300 truncate flex-1 font-mono">{file.filename}</span>
                        <Show when={rank()}>
                          <ScoreBadge label={rank()!.label} />
                        </Show>
                      </button>
                    )
                  }}
                </For>
              </Show>

              <Show when={filteredFiles().length === 0 && filteredClusters().length === 0}>
                <div class="px-3 py-6 text-center text-slate-500 text-sm">
                  No files match "{query()}". Try a shorter search.
                </div>
              </Show>
            </div>
          </div>
        </div>
      </Portal>
    </Show>
  )
}
