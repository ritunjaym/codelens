import { For, Show } from 'solid-js'
import { usePartyKit } from '@/hooks/usePartyKit'

interface Props { prId: string }

export function PresenceBar(props: Props) {
  const { connected, presence } = usePartyKit(props.prId)

  return (
    <div class="flex items-center gap-2">
      <span class={`w-1.5 h-1.5 rounded-full ${connected() ? 'bg-green-400' : 'bg-red-500'}`} />
      <span class="text-xs text-slate-500">{connected() ? 'Live' : 'Offline'}</span>
      <div class="flex -space-x-1">
        <For each={presence().slice(0, 5)}>
          {user => (
            <img
              src={user.avatar}
              title={user.name}
              class="w-5 h-5 rounded-full border border-slate-800"
              style={{ outline: `1px solid ${user.color}` }}
            />
          )}
        </For>
        <Show when={presence().length > 5}>
          <div class="w-5 h-5 rounded-full bg-slate-700 border border-slate-800 flex items-center justify-center text-xs text-slate-400">
            +{presence().length - 5}
          </div>
        </Show>
      </div>
    </div>
  )
}
