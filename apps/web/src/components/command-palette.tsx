"use client"

import { useState, useEffect } from "react"
import { Command } from "cmdk"

interface CommandItem {
  id: string
  label: string
  description?: string
  group: "Files" | "Clusters" | "Actions"
  onSelect: () => void
}

interface CommandPaletteProps {
  open: boolean
  onClose: () => void
  items: CommandItem[]
}

export function CommandPalette({ open, onClose, items }: CommandPaletteProps) {
  const [search, setSearch] = useState("")

  useEffect(() => {
    if (!open) setSearch("")
  }, [open])

  if (!open) return null

  const groups = ["Files", "Clusters", "Actions"] as const

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-16 sm:pt-24 px-4"
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
    >
      <div className="absolute inset-0 bg-background/60 backdrop-blur-sm animate-fade-in" onClick={onClose} />
      <div className="relative w-full max-w-lg bg-background border border-border rounded-xl shadow-2xl overflow-hidden animate-slide-in-top">
        <Command>
          <div className="flex items-center border-b border-border px-3">
            <span className="text-muted-foreground mr-2 text-sm">⌘</span>
            <Command.Input
              value={search}
              onValueChange={setSearch}
              placeholder="Search files, clusters, actions..."
              className="flex-1 py-3 text-sm bg-transparent outline-none placeholder:text-muted-foreground"
              aria-label="Search command palette"
            />
            <kbd className="text-xs text-muted-foreground border border-border rounded px-1">Esc</kbd>
          </div>

          <Command.List className="max-h-72 overflow-y-auto p-2">
            <Command.Empty className="py-6 text-center text-sm text-muted-foreground">
              {search ? `No files match "${search}". Try a shorter search.` : "No results found."}
            </Command.Empty>

            {groups.map(group => {
              const groupItems = items.filter(i => i.group === group)
              if (groupItems.length === 0) return null
              return (
                <Command.Group key={group} heading={group} className="[&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wide [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1">
                  {groupItems.map(item => (
                    <Command.Item
                      key={item.id}
                      value={`${item.label} ${item.description ?? ""}`}
                      onSelect={() => { item.onSelect(); onClose() }}
                      className="flex items-center gap-2 px-2 py-1.5 rounded text-sm cursor-pointer data-[selected=true]:bg-muted aria-selected:bg-muted"
                    >
                      <span className="flex-1 truncate">{item.label}</span>
                      {item.description && (
                        <span className="text-xs text-muted-foreground truncate max-w-32">{item.description}</span>
                      )}
                    </Command.Item>
                  ))}
                </Command.Group>
              )
            })}
          </Command.List>
        </Command>
      </div>
    </div>
  )
}
