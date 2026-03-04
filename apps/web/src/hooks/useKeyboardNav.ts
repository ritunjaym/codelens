"use client"

import { useRef, useEffect, useState, useCallback } from "react"
import { useHotkeys } from "@/hooks/use-hotkeys"
import { useRouter } from "next/navigation"

interface UseKeyboardNavOptions {
  files: string[]
  onSelectFile: (f: string) => void
  onOpenComment: () => void
}

export function useKeyboardNav({ files, onSelectFile, onOpenComment }: UseKeyboardNavOptions) {
  const router = useRouter()
  const [focusedIndex, setFocusedIndex] = useState(0)
  // Keep ref in sync for use in callbacks without stale closures
  const focusedIndexRef = useRef(0)
  const pendingKeyRef = useRef<string | null>(null)
  const pendingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Keep files ref to avoid stale closure in hotkey callbacks
  const filesRef = useRef(files)
  filesRef.current = files

  const moveTo = useCallback((index: number) => {
    focusedIndexRef.current = index
    setFocusedIndex(index)
    const file = filesRef.current[index]
    if (file) onSelectFile(file)
  }, [onSelectFile])

  useHotkeys([
    {
      key: "j",
      description: "Next file",
      callback: () => {
        const next = Math.min(filesRef.current.length - 1, focusedIndexRef.current + 1)
        moveTo(next)
      },
    },
    {
      key: "k",
      description: "Previous file",
      callback: () => {
        const prev = Math.max(0, focusedIndexRef.current - 1)
        moveTo(prev)
      },
    },
    {
      key: "c",
      description: "Comment on focused line",
      callback: onOpenComment,
    },
  ])

  // g→d sequence via raw keydown to avoid modifier constraints in useHotkeys
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const el = document.activeElement
      const tag = (el?.tagName ?? "").toLowerCase()
      if (tag === "input" || tag === "textarea" || el?.getAttribute("contenteditable") === "true") return

      if (e.key === "g" && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
        if (pendingTimerRef.current) clearTimeout(pendingTimerRef.current)
        pendingKeyRef.current = "g"
        pendingTimerRef.current = setTimeout(() => {
          pendingKeyRef.current = null
        }, 1000)
      } else if (e.key === "d" && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
        if (pendingKeyRef.current === "g") {
          e.preventDefault()
          if (pendingTimerRef.current) clearTimeout(pendingTimerRef.current)
          pendingKeyRef.current = null
          router.push("/dashboard")
        }
      } else {
        pendingKeyRef.current = null
        if (pendingTimerRef.current) clearTimeout(pendingTimerRef.current)
      }
    }

    document.addEventListener("keydown", handleKeyDown)
    return () => {
      document.removeEventListener("keydown", handleKeyDown)
      if (pendingTimerRef.current) clearTimeout(pendingTimerRef.current)
    }
  }, [router])

  return {
    focusedIndex,
    focusedFile: files[focusedIndex] ?? null,
  }
}
