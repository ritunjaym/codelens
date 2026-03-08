import { For, Show } from 'solid-js'
import { useTimeline } from '@/hooks/queries'
import { formatDistanceToNow } from 'date-fns'

interface Props { owner: string; repo: string; number: number }

export function Timeline(props: Props) {
  const timeline = useTimeline(
    () => props.owner,
    () => props.repo,
    () => props.number
  )

  return (
    <div class="p-4 space-y-3">
      <Show when={timeline.isLoading}>
        {[...Array(5)].map(() => (
          <div class="flex gap-3">
            <div class="w-6 h-6 rounded-full bg-slate-800 animate-pulse shrink-0" />
            <div class="flex-1 space-y-1">
              <div class="h-3 bg-slate-800 rounded animate-pulse w-3/4" />
              <div class="h-2 bg-slate-800 rounded animate-pulse w-1/2" />
            </div>
          </div>
        ))}
      </Show>
      <Show when={timeline.data?.length === 0}>
        <p class="text-slate-600 text-sm text-center py-8">No activity yet on this PR.</p>
      </Show>
      <For each={timeline.data}>
        {event => (
          <div class="flex items-start gap-3">
            <img
              src={(event.actor ?? event.user)?.avatar_url}
              class="w-6 h-6 rounded-full mt-0.5 shrink-0"
            />
            <div class="flex-1 min-w-0">
              <p class="text-xs text-slate-300">
                <span class="font-medium">{(event.actor ?? event.user)?.login}</span>
                {' '}
                <span class="text-slate-400">
                  {event.event ?? event.state ?? 'commented'}
                </span>
              </p>
              <p class="text-xs text-slate-600">
                {formatDistanceToNow(new Date(event.created_at))} ago
              </p>
            </div>
          </div>
        )}
      </For>
    </div>
  )
}
