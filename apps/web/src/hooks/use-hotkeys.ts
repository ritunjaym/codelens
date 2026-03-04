"use client"

import { useEffect, useCallback } from "react"

interface HotkeyConfig {
  key: string
  callback: (e: KeyboardEvent) => void
  description?: string
  ctrlOrMeta?: boolean
  shift?: boolean
}

function isInputFocused(): boolean {
  const el = document.activeElement
  if (!el) return false
  const tag = el.tagName.toLowerCase()
  return tag === "input" || tag === "textarea" || el.getAttribute("contenteditable") === "true"
}

export function useHotkeys(hotkeys: HotkeyConfig[]) {
  const handler = useCallback((e: KeyboardEvent) => {
    if (isInputFocused()) return

    for (const hk of hotkeys) {
      const metaMatch = hk.ctrlOrMeta ? (e.ctrlKey || e.metaKey) : !(e.ctrlKey || e.metaKey)
      const shiftMatch = hk.shift ? e.shiftKey : !e.shiftKey
      
      if (e.key === hk.key && metaMatch && shiftMatch) {
        e.preventDefault()
        hk.callback(e)
        return
      }
    }
  }, [hotkeys])

  useEffect(() => {
    document.addEventListener("keydown", handler)
    return () => document.removeEventListener("keydown", handler)
  }, [handler])
}

export const KEYBOARD_SHORTCUTS: Array<{ keys: string; description: string; category: string }> = [
  { keys: "j / ↓", description: "Next file", category: "Navigation" },
  { keys: "k / ↑", description: "Previous file", category: "Navigation" },
  { keys: "⌘K", description: "Open command palette", category: "Navigation" },
  { keys: "?", description: "Show keyboard shortcuts", category: "Navigation" },
  { keys: "o", description: "Toggle Review Order mode", category: "View" },
  { keys: "Esc", description: "Close panel / modal", category: "View" },
  { keys: "1-9", description: "Jump to file by rank", category: "Navigation" },
  { keys: "/", description: "Focus search", category: "Navigation" },
  { keys: "c", description: "Comment on focused line", category: "Actions" },
  { keys: "g d", description: "Go to dashboard", category: "Navigation" },
  { keys: "Enter", description: "Expand/collapse focused file", category: "Navigation" },
]
