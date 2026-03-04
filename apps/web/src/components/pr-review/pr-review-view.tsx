"use client"

import { useState, useMemo, useCallback } from "react"
import { useRouter } from "next/navigation"
import { FileList, FileListItem } from "./file-list"
import { DiffViewer } from "./diff-viewer"
import { ClusterPanel } from "@/components/cluster-panel"
import { RankBadge } from "@/components/rank-badge"
import { ScoreLabelBadge } from "@/components/score-label-badge"
import { MLUnavailableBanner } from "@/components/ml-unavailable-banner"
import { CommandPalette } from "@/components/command-palette"
import { KeyboardShortcutsModal } from "@/components/keyboard-shortcuts-modal"
import { PresenceBar } from "@/components/presence-bar"
import { useKeyboardNav } from "@/hooks/useKeyboardNav"
import { useHotkeys } from "@/hooks/use-hotkeys"
import { usePRRoom } from "@/hooks/use-pr-room"

interface RankedFileData {
  filename: string
  rank: number
  reranker_score: number
  retrieval_score: number
  final_score: number
  label: string
  explanation: string
}

interface ClusterData {
  cluster_id: number
  label: string
  files: string[]
  coherence: number
}

interface PRFile {
  filename: string
  additions: number
  deletions: number
  patch?: string
}

interface PRReviewViewProps {
  files: PRFile[]
  rankingData: { ranked_files: RankedFileData[] } | null
  clusterData: { groups: ClusterData[] } | null
  prTitle: string
  prId?: string
  currentUser?: { name: string; image?: string }
}

export function PRReviewView({ files, rankingData, clusterData, prTitle, prId, currentUser }: PRReviewViewProps) {
  const router = useRouter()
  const [selectedFile, setSelectedFile] = useState<string | null>(files[0]?.filename ?? null)
  const [viewMode, setViewMode] = useState<"unified" | "split">("unified")
  const [reviewOrder, setReviewOrder] = useState(false)
  const [selectedCluster, setSelectedCluster] = useState<number | null>(null)
  const [showPalette, setShowPalette] = useState(false)
  const [showShortcuts, setShowShortcuts] = useState(false)
  const [commentLineOpen, setCommentLineOpen] = useState<number | null>(null)

  const mlUnavailable = !rankingData && !clusterData

  // Merge ranking data into files
  const enrichedFiles = useMemo<FileListItem[]>(() => {
    const rankMap = new Map(
      rankingData?.ranked_files.map(r => [r.filename, r]) ?? []
    )
    const clusterMap = new Map<string, { id: number; label: string }>()
    clusterData?.groups.forEach(g => {
      g.files.forEach(f => clusterMap.set(f, { id: g.cluster_id, label: g.label }))
    })

    const enriched = files.map(f => ({
      ...f,
      rank: rankMap.get(f.filename)?.rank,
      finalScore: rankMap.get(f.filename)?.final_score,
      rerankerScore: rankMap.get(f.filename)?.reranker_score,
      retrievalScore: rankMap.get(f.filename)?.retrieval_score,
      label: rankMap.get(f.filename)?.label,
      explanation: rankMap.get(f.filename)?.explanation,
      clusterId: clusterMap.get(f.filename)?.id,
      clusterLabel: clusterMap.get(f.filename)?.label,
    }))

    if (reviewOrder && rankingData) {
      return [...enriched].sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999))
    }
    return enriched
  }, [files, rankingData, clusterData, reviewOrder])

  const fileNames = useMemo(() => enrichedFiles.map(f => f.filename), [enrichedFiles])

  const handleSelectFile = useCallback((filename: string) => {
    setSelectedFile(filename)
  }, [])

  const { focusedFile } = useKeyboardNav({
    files: fileNames,
    onSelectFile: handleSelectFile,
    onOpenComment: () => setCommentLineOpen(0),
  })

  // ⌘K and ? hotkeys
  useHotkeys([
    {
      key: "k",
      ctrlOrMeta: true,
      description: "Open command palette",
      callback: () => setShowPalette(true),
    },
    {
      key: "?",
      shift: true,
      description: "Show keyboard shortcuts",
      callback: () => setShowShortcuts(true),
    },
    {
      key: "Escape",
      description: "Close panel / modal",
      callback: () => {
        setShowPalette(false)
        setShowShortcuts(false)
        setCommentLineOpen(null)
      },
    },
  ])

  // PartyKit presence
  const { presences, connected } = usePRRoom(
    prId ?? "",
    currentUser ? { name: currentUser.name, image: currentUser.image } : undefined
  )

  const selectedFileData = useMemo(
    () => files.find(f => f.filename === selectedFile),
    [files, selectedFile]
  )

  const selectedFileRank = useMemo(
    () => enrichedFiles.find(f => f.filename === selectedFile),
    [enrichedFiles, selectedFile]
  )

  // Build command palette items
  const paletteItems = useMemo(() => {
    const fileItems = enrichedFiles.map(f => ({
      id: `file:${f.filename}`,
      label: f.filename,
      description: f.label,
      group: "Files" as const,
      onSelect: () => setSelectedFile(f.filename),
    }))

    const clusterItems = clusterData?.groups.map(g => ({
      id: `cluster:${g.cluster_id}`,
      label: g.label,
      description: `${g.files.length} files`,
      group: "Clusters" as const,
      onSelect: () => setSelectedCluster(g.cluster_id),
    })) ?? []

    const actionItems = [
      {
        id: "action:dashboard",
        label: "Go to Dashboard",
        group: "Actions" as const,
        onSelect: () => router.push("/dashboard"),
      },
    ]

    return [...fileItems, ...clusterItems, ...actionItems]
  }, [enrichedFiles, clusterData, router])

  return (
    <div className="flex h-[calc(100vh-57px)] overflow-hidden">
      {/* Left panel: file list + cluster panel */}
      <div className="w-72 border-r border-border flex flex-col shrink-0">
        {/* Toolbar */}
        <div className="px-3 py-2 border-b border-border flex items-center gap-2 flex-wrap">
          <button
            className={`text-xs px-2 py-1 rounded transition-colors ${reviewOrder ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
            onClick={() => setReviewOrder(v => !v)}
            aria-pressed={reviewOrder}
          >
            Review Order
          </button>
          <button
            className={`text-xs px-2 py-1 rounded transition-colors ${viewMode === "split" ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
            onClick={() => setViewMode(v => v === "unified" ? "split" : "unified")}
          >
            {viewMode === "unified" ? "Split" : "Unified"}
          </button>
          {prId && (
            <div className="ml-auto flex items-center gap-2">
              <PresenceBar presences={presences} />
              <span className={`text-[10px] ${connected ? "text-green-400" : "text-red-400"}`}>
                ● {connected ? "Live" : "Offline"}
              </span>
            </div>
          )}
        </div>

        {/* Cluster panel */}
        {clusterData && (
          <div className="border-b border-border">
            <ClusterPanel
              clusters={clusterData.groups}
              selectedClusterId={selectedCluster}
              onSelectCluster={setSelectedCluster}
            />
          </div>
        )}

        {/* File list */}
        <div className="flex-1 overflow-hidden">
          <FileList
            files={enrichedFiles}
            selectedFile={selectedFile}
            onSelectFile={setSelectedFile}
            filterClusterId={selectedCluster}
            focusedFile={focusedFile}
          />
        </div>
      </div>

      {/* Right panel: diff viewer */}
      <div className="flex-1 overflow-y-auto pb-10">
        {mlUnavailable && (
          <div className="px-6 pt-4">
            <MLUnavailableBanner />
          </div>
        )}

        {selectedFileData ? (
          <div className="p-4">
            {/* File header */}
            <div className="flex items-center gap-3 mb-4 pb-3 border-b border-border">
              {selectedFileRank?.finalScore != null && (
                <RankBadge file={{
                  rank: selectedFileRank.rank,
                  finalScore: selectedFileRank.finalScore,
                  rerankerScore: selectedFileRank.rerankerScore,
                  retrievalScore: selectedFileRank.retrievalScore,
                  explanation: selectedFileRank.explanation,
                }} />
              )}
              {selectedFileRank?.label != null && (
                <ScoreLabelBadge label={selectedFileRank.label} />
              )}
              <span className="font-mono text-sm font-medium">{selectedFileData.filename}</span>
              <span className="ml-auto flex items-center gap-2 text-xs">
                <span className="text-green-500">+{selectedFileData.additions}</span>
                <span className="text-red-500">-{selectedFileData.deletions}</span>
              </span>
            </div>

            <DiffViewer
              patch={selectedFileData.patch ?? ""}
              filename={selectedFileData.filename}
              viewMode={viewMode}
              prId={prId}
              currentUser={currentUser}
              activeCommentLine={commentLineOpen}
              onCommentClose={() => setCommentLineOpen(null)}
            />
          </div>
        ) : (
          <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
            Select a file to view its diff
          </div>
        )}
      </div>

      {/* Keyboard shortcut hints bar */}
      <div className="fixed bottom-0 left-0 right-0 z-40 border-t border-border bg-background/80 backdrop-blur-sm px-4 py-1.5 flex items-center gap-4 text-[10px] text-muted-foreground">
        <span><kbd className="font-mono bg-muted border border-border rounded px-1">j</kbd> <kbd className="font-mono bg-muted border border-border rounded px-1">k</kbd> navigate</span>
        <span><kbd className="font-mono bg-muted border border-border rounded px-1">c</kbd> comment</span>
        <span><kbd className="font-mono bg-muted border border-border rounded px-1">⌘K</kbd> search</span>
        <span><kbd className="font-mono bg-muted border border-border rounded px-1">?</kbd> shortcuts</span>
      </div>

      {/* Modals */}
      <CommandPalette
        open={showPalette}
        onClose={() => setShowPalette(false)}
        items={paletteItems}
      />
      <KeyboardShortcutsModal
        open={showShortcuts}
        onClose={() => setShowShortcuts(false)}
      />
    </div>
  )
}
