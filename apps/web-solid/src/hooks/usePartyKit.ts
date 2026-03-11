import { createSignal, onCleanup } from 'solid-js'
import { session } from '@/stores/session'

interface Presence {
  id: string
  name: string
  avatar: string
  color: string
}

export interface GithubEventMessage {
  event: string
  payload: unknown
}

const COLORS = ['#3b82f6', '#8b5cf6', '#ec4899', '#10b981', '#f59e0b', '#ef4444']

export function usePartyKit(prId: string) {
  const [connected, setConnected] = createSignal(false)
  const [presence, setPresence] = createSignal<Presence[]>([])
  const [lastGithubEvent, setLastGithubEvent] = createSignal<GithubEventMessage | null>(null)
  let ws: WebSocket | null = null

  const PARTYKIT_HOST = import.meta.env.VITE_PARTYKIT_HOST
  if (!PARTYKIT_HOST) return { connected, presence, lastGithubEvent }

  const roomId = `pr-${prId}`.replace(/[^a-z0-9-]/gi, '-').toLowerCase()
  const url = `wss://${PARTYKIT_HOST}/parties/main/${roomId}`

  function connect() {
    ws = new WebSocket(url)

    ws.onopen = () => {
      setConnected(true)
      ws?.send(JSON.stringify({
        type: 'presence',
        user: {
          id: session()?.user.login ?? 'anon',
          name: session()?.user.name ?? session()?.user.login ?? 'Anonymous',
          avatar: session()?.user.avatar_url ?? '',
          color: COLORS[Math.floor(Math.random() * COLORS.length)],
        },
      }))
    }

    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data) as { type: string; users?: Presence[]; event?: string; payload?: unknown }
        if (msg.type === 'presence_update') setPresence(msg.users ?? [])
        if (msg.type === 'github_event') setLastGithubEvent({ event: msg.event ?? '', payload: msg.payload })
        if (msg.type === 'new_comment') setLastGithubEvent({ event: 'new_comment', payload: msg })
      } catch {}
    }

    ws.onclose = () => {
      setConnected(false)
      setTimeout(connect, 3000)
    }

    ws.onerror = () => ws?.close()
  }

  connect()
  onCleanup(() => ws?.close())

  return { connected, presence, lastGithubEvent }
}
