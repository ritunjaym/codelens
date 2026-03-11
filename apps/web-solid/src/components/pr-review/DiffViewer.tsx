import { createSignal, For, Show, createMemo } from 'solid-js'
import { useQueryClient } from '@tanstack/solid-query'
import type { PRFile } from '@/lib/github'
import type { RankedFile } from '@/lib/ml'
import { ScoreBadge } from '@/components/ScoreBadge'

interface DiffLine {
  type: 'add' | 'remove' | 'context' | 'hunk'
  content: string
  oldLine: number | null
  newLine: number | null
}

function parsePatch(patch: string): DiffLine[] {
  const lines = patch.split('\n')
  const result: DiffLine[] = []
  let oldLine = 0, newLine = 0

  for (const line of lines) {
    if (line.startsWith('@@')) {
      const match = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)/)
      if (match) { oldLine = parseInt(match[1]); newLine = parseInt(match[2]) }
      result.push({ type: 'hunk', content: line, oldLine: null, newLine: null })
    } else if (line.startsWith('+')) {
      result.push({ type: 'add', content: line.slice(1), oldLine: null, newLine: newLine++ })
    } else if (line.startsWith('-')) {
      result.push({ type: 'remove', content: line.slice(1), oldLine: oldLine++, newLine: null })
    } else {
      result.push({ type: 'context', content: line.slice(1), oldLine: oldLine++, newLine: newLine++ })
    }
  }
  return result
}

interface Props {
  file: PRFile | null
  rank: RankedFile | null
  prId: string
  owner: string
  repo: string
  commentOpen: boolean
  onCommentClose: () => void
}

export function DiffViewer(props: Props) {
  const queryClient = useQueryClient()
  const [activeCommentLine, setActiveCommentLine] = createSignal<number | null>(null)
  const [commentText, setCommentText] = createSignal('')
  const [comments, setComments] = createSignal<Array<{ line: number; body: string; author: string }>>([])
  const [failedLines, setFailedLines] = createSignal(new Set<number>())

  const lines = createMemo(() => {
    if (!props.file?.patch) return []
    return parsePatch(props.file.patch)
  })

  async function submitComment(line: number) {
    const body = commentText()
    if (!body.trim()) return

    setComments(prev => [...prev, { line, body, author: 'you' }])
    setCommentText('')
    setActiveCommentLine(null)

    let attempts = 0
    const delays = [1000, 2000, 4000]
    while (attempts < 3) {
      try {
        const res = await fetch('/api/github/comment', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            owner: props.owner, repo: props.repo,
            pr_number: props.prId, body, path: props.file?.filename, line,
          }),
        })
        if (res.ok) {
          queryClient.invalidateQueries({ queryKey: ['timeline'] })
          const partykitHost = import.meta.env.VITE_PARTYKIT_HOST
          if (partykitHost) {
            const room = `pr-${props.owner}-${props.repo}-${props.prId}`.replace(/[^a-z0-9-]/gi, '-').toLowerCase()
            fetch(`https://${partykitHost}/parties/main/${room}`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ type: 'new_comment', filename: props.file?.filename, body }),
            }).catch(() => {})
          }
          return
        }
      } catch {}
      attempts++
      if (attempts < 3) await new Promise(r => setTimeout(r, delays[attempts - 1]))
    }
    setFailedLines(prev => new Set([...prev, line]))
  }

  return (
    <Show when={props.file} fallback={
      <div class="flex items-center justify-center h-full text-[var(--text-muted)]">
        <p class="text-sm">Select a file to review</p>
      </div>
    }>
      <div class="bg-[var(--bg-surface)] border border-[var(--border)] rounded-lg overflow-hidden m-4">
        {/* File header */}
        <div class="px-4 py-2.5 border-b border-[var(--border)] bg-[var(--bg-elevated)] flex items-center gap-3">
          <span class="mono text-xs text-[var(--text-primary)] font-medium truncate flex-1">{props.file?.filename}</span>
          <Show when={props.rank}>
            <ScoreBadge label={props.rank!.label} />
          </Show>
          <span class="text-xs shrink-0">
            <span class="text-[var(--success)]">+{props.file?.additions}</span>
            {' '}
            <span class="text-[var(--critical)]">-{props.file?.deletions}</span>
          </span>
        </div>

        {/* Diff lines */}
        <Show when={props.file?.patch} fallback={
          <div class="p-4 text-[var(--text-muted)] text-xs mono italic">
            {props.file?.status === 'binary' ? 'Binary file' : 'No diff available'}
          </div>
        }>
          <div class="mono text-xs leading-5">
            <table class="w-full border-collapse">
              <tbody>
                <For each={lines()}>
                  {(line, i) => (
                    <>
                      <tr
                        class={`group cursor-pointer ${
                          line.type === 'add' ? 'bg-[var(--add)]' :
                          line.type === 'remove' ? 'bg-[var(--remove)]' :
                          line.type === 'hunk' ? 'bg-[var(--accent-subtle)]' :
                          'hover:bg-[var(--bg-elevated)]'
                        }`}
                        onClick={() => line.type !== 'hunk' && setActiveCommentLine(
                          activeCommentLine() === i() ? null : i()
                        )}
                      >
                        <td class="w-10 px-2 py-0.5 text-[var(--text-muted)] select-none text-right border-r border-[var(--border-subtle)]">
                          {line.oldLine ?? ''}
                        </td>
                        <td class="w-10 px-2 py-0.5 text-[var(--text-muted)] select-none text-right border-r border-[var(--border-subtle)]">
                          {line.newLine ?? ''}
                        </td>
                        <td class={`px-3 py-0.5 whitespace-pre ${
                          line.type === 'add' ? 'text-[var(--success)]' :
                          line.type === 'remove' ? 'text-[var(--critical)]' :
                          line.type === 'hunk' ? 'text-[var(--accent)]' :
                          'text-[var(--text-secondary)]'
                        }`}>
                          {line.type === 'add' ? '+' : line.type === 'remove' ? '-' : line.type === 'hunk' ? '' : ' '}
                          {line.content}
                        </td>
                        <td class="w-6 px-1 opacity-0 group-hover:opacity-100">
                          <button class="text-[var(--text-muted)] hover:text-[var(--accent)] transition-colors text-xs">+</button>
                        </td>
                      </tr>

                      {/* Inline comments */}
                      <For each={comments().filter(c => c.line === i())}>
                        {comment => (
                          <tr>
                            <td colspan={4} class="px-4 py-2 bg-[var(--accent-subtle)] border-l-2 border-[var(--accent)]">
                              <div class="flex items-start gap-2">
                                <span class="text-[var(--accent)] text-xs font-medium">{comment.author}</span>
                                <span class="text-[var(--text-secondary)] text-xs">{comment.body}</span>
                                <Show when={failedLines().has(comment.line)}>
                                  <span class="text-[var(--critical)] text-xs ml-auto">
                                    Failed to post ·{' '}
                                    <button
                                      class="underline"
                                      onClick={() => submitComment(comment.line)}
                                    >Retry</button>
                                  </span>
                                </Show>
                              </div>
                            </td>
                          </tr>
                        )}
                      </For>

                      {/* Comment input */}
                      <Show when={activeCommentLine() === i()}>
                        <tr>
                          <td colspan={4} class="px-4 py-3 bg-[var(--bg-elevated)]">
                            <textarea
                              class="w-full bg-[var(--bg-surface)] text-[var(--text-primary)] text-xs p-2 rounded border border-[var(--border)] resize-none focus:outline-none focus:border-[var(--accent)] transition-colors mono"
                              rows={3}
                              placeholder="Add a review comment..."
                              value={commentText()}
                              onInput={e => setCommentText(e.currentTarget.value)}
                              autofocus
                            />
                            <div class="flex gap-2 mt-2">
                              <button
                                class="text-xs bg-[var(--accent)] hover:bg-[var(--accent)]/80 text-white px-3 py-1 rounded transition-colors"
                                onClick={() => submitComment(i())}
                              >Comment</button>
                              <button
                                class="text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] px-3 py-1 rounded transition-colors"
                                onClick={() => setActiveCommentLine(null)}
                              >Cancel</button>
                            </div>
                          </td>
                        </tr>
                      </Show>
                    </>
                  )}
                </For>
              </tbody>
            </table>
          </div>
        </Show>
      </div>
    </Show>
  )
}
