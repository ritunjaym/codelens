import { createMemo, For, Show } from 'solid-js'
import { createVirtualizer } from '@tanstack/solid-virtual'
import { ScoreBadge } from '@/components/ScoreBadge'
import type { PRFile } from '@/lib/github'
import type { RankedFile } from '@/lib/ml'

interface Props {
  files: PRFile[]
  rankedFiles: RankedFile[]
  selectedFile: string | null
  focusedFile: string | null
  selectedCluster: string | null
  clusterFileMap: Record<string, string>
  aiPriority: boolean
  onSelectFile: (filename: string) => void
}

export function FileList(props: Props) {
  let parentRef!: HTMLDivElement

  const sortedFiles = createMemo(() => {
    if (!props.aiPriority || props.rankedFiles.length === 0) return props.files
    const scoreMap = new Map(props.rankedFiles.map(r => [r.filename, r.final_score]))
    return [...props.files].sort((a, b) => (scoreMap.get(b.filename) ?? 0) - (scoreMap.get(a.filename) ?? 0))
  })

  const virtualizer = createVirtualizer({
    get count() { return sortedFiles().length },
    getScrollElement: () => parentRef,
    estimateSize: () => 52,
    overscan: 5,
  })

  const rankMap = createMemo(() =>
    new Map(props.rankedFiles.map(r => [r.filename, r]))
  )

  return (
    <div ref={parentRef} class="overflow-y-auto h-full">
      <div style={{ height: `${virtualizer.getTotalSize()}px`, position: 'relative' }}>
        <For each={virtualizer.getVirtualItems()}>
          {(virtualRow) => {
            const file = () => sortedFiles()[virtualRow.index]
            const rank = () => rankMap().get(file().filename)
            const isSelected = () => props.selectedFile === file().filename
            const clusterColor = () => props.clusterFileMap[file().filename]
            const shortFilename = () => {
              const parts = file().filename.split('/')
              return parts.length > 2 ? `.../${parts.slice(-2).join('/')}` : file().filename
            }

            return (
              <div
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  height: `${virtualRow.size}px`,
                  transform: `translateY(${virtualRow.start}px)`,
                }}
              >
                <div
                  class={`px-3 py-2 cursor-pointer border-l-2 transition-all ${
                    isSelected() ? 'border-[var(--accent)] bg-[var(--bg-elevated)]' : 'border-transparent hover:bg-[var(--bg-elevated)]'
                  }`}
                  style={clusterColor() ? { 'border-left-color': clusterColor() } : {}}
                  onClick={() => props.onSelectFile(file().filename)}
                >
                  <div class="flex items-center justify-between gap-2">
                    <span class="mono text-xs text-[var(--text-primary)] truncate">{shortFilename()}</span>
                    <Show when={rank() && props.aiPriority}>
                      <ScoreBadge label={rank()!.label} />
                    </Show>
                  </div>
                  <div class="flex gap-2 mt-0.5 mono text-[10px]">
                    <span class="text-[var(--success)]">+{file().additions}</span>
                    <span class="text-[var(--critical)]">-{file().deletions}</span>
                  </div>
                </div>
              </div>
            )
          }}
        </For>
      </div>
    </div>
  )
}
