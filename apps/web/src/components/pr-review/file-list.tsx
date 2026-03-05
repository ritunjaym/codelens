"use client"

import { useVirtualizer } from "@tanstack/react-virtual"
import { useRef, useState } from "react"
import { detectLanguage } from "@/lib/language"

export interface FileListItem {
  filename: string
  additions: number
  deletions: number
  patch?: string
  rank?: number
  finalScore?: number
  rerankerScore?: number
  retrievalScore?: number
  label?: string
  explanation?: string
  clusterId?: number
  clusterLabel?: string
}

interface FileListProps {
  files: FileListItem[]
  selectedFile: string | null
  onSelectFile: (filename: string) => void
  filterClusterId?: number | null
  focusedFile?: string | null
  clusterHighlightColor?: string | null
}

function LabelBadge({ label }: { label: string }) {
  const styles =
    label === "Critical" ? "bg-red-500/20 text-red-400 border-red-500/40" :
    label === "Important" ? "bg-yellow-500/20 text-yellow-400 border-yellow-500/40" :
    "bg-muted text-muted-foreground border-border"

  return (
    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border ${styles}`}>
      {label}
    </span>
  )
}

export function FileList({ files, selectedFile, onSelectFile, filterClusterId, focusedFile, clusterHighlightColor }: FileListProps) {
  const parentRef = useRef<HTMLDivElement>(null)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())

  const filteredFiles = filterClusterId != null
    ? files.filter(f => f.clusterId === filterClusterId)
    : files

  const virtualizer = useVirtualizer({
    count: filteredFiles.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 52,
    overscan: 5,
  })

  if (filteredFiles.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        No files
      </div>
    )
  }

  return (
    <div ref={parentRef} className="h-full overflow-y-auto" role="list" aria-label="Changed files">
      <div style={{ height: `${virtualizer.getTotalSize()}px`, position: "relative" }}>
        {virtualizer.getVirtualItems().map((virtualItem) => {
          const file = filteredFiles[virtualItem.index]
          const isSelected = selectedFile === file.filename
          const isCollapsed = collapsed.has(file.filename)
          const isClusterHighlighted =
            clusterHighlightColor != null &&
            filterClusterId != null &&
            file.clusterId === filterClusterId

          return (
            <div
              key={virtualItem.key}
              style={{ position: "absolute", top: 0, left: 0, width: "100%", transform: `translateY(${virtualItem.start}px)` }}
            >
              <button
                className={`w-full text-left px-3 py-2 text-xs hover:bg-muted/50 transition-colors flex items-center gap-2 ${isSelected ? "bg-muted border-l-2 border-primary" : isClusterHighlighted ? `border-l-4 ${clusterHighlightColor}` : "border-l-2 border-transparent"} ${file.filename === focusedFile ? "ring-2 ring-primary ring-offset-1" : ""}`}
                onClick={() => onSelectFile(file.filename)}
                tabIndex={0}
                aria-selected={isSelected}
                role="listitem"
              >
                {file.label != null && <LabelBadge label={file.label} />}
                <span className="flex-1 truncate font-mono text-[11px]">{file.filename}</span>
                <span className="flex items-center gap-1 shrink-0">
                  <span className="text-green-500 text-[10px]">+{file.additions}</span>
                  <span className="text-red-500 text-[10px]">-{file.deletions}</span>
                </span>
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
