import { Show } from 'solid-js'
import { Portal } from 'solid-js/web'

const SHORTCUTS = [
  { key: 'j / k', description: 'Navigate files', category: 'Navigation' },
  { key: 'c', description: 'Comment on focused line', category: 'Actions' },
  { key: 'o', description: 'Toggle AI Priority order', category: 'Actions' },
  { key: '⌘K', description: 'Open command palette', category: 'Navigation' },
  { key: '?', description: 'Show this modal', category: 'Navigation' },
  { key: 'g d', description: 'Go to dashboard', category: 'Navigation' },
  { key: 'Esc', description: 'Close modal / palette', category: 'Navigation' },
]

interface Props { open: boolean; onClose: () => void }

export function KeyboardShortcutsModal(props: Props) {
  return (
    <Show when={props.open}>
      <Portal>
        <div class="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center"
          onClick={props.onClose}>
          <div class="bg-slate-800 rounded-xl border border-slate-700 p-6 w-96 shadow-2xl"
            onClick={e => e.stopPropagation()}>
            <div class="flex items-center justify-between mb-4">
              <h2 class="text-white font-semibold">Keyboard Shortcuts</h2>
              <button class="text-slate-400 hover:text-white" onClick={props.onClose}>✕</button>
            </div>
            <div class="space-y-2">
              {SHORTCUTS.map(s => (
                <div class="flex items-center justify-between py-1">
                  <span class="text-slate-400 text-sm">{s.description}</span>
                  <kbd class="bg-slate-700 text-slate-200 text-xs px-2 py-0.5 rounded font-mono">{s.key}</kbd>
                </div>
              ))}
            </div>
          </div>
        </div>
      </Portal>
    </Show>
  )
}
