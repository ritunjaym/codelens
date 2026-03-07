import { createEffect, Show } from 'solid-js'
import type { ParentProps } from 'solid-js'
import { useNavigate } from '@tanstack/solid-router'
import { session, sessionLoaded } from '@/stores/session'

export function AuthGuard(props: ParentProps) {
  const navigate = useNavigate()

  createEffect(() => {
    if (sessionLoaded() && !session()) {
      navigate({ to: '/login' })
    }
  })

  return (
    <Show when={session()} fallback={
      <div class="flex items-center justify-center h-screen">
        <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" />
      </div>
    }>
      {props.children}
    </Show>
  )
}
