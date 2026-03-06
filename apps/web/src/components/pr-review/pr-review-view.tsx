"use client"

import { useState, useMemo, useCallback, useEffect, useRef } from "react"
import { useRouter } from "next/navigation"
import { FileList, FileListItem } from "./file-list"
import { DiffViewer } from "./diff-viewer"
import { Timeline } from "./timeline"
import { ClusterPanel, CLUSTER_BORDER_COLORS } from "@/components/cluster-panel"
import { RankBadge } from "@/components/rank-badge"
import { ScoreLabelBadge } from "@/components/score-label-badge"
import { MLUnavailableBanner } from "@/components/ml-unavailable-banner"
import { CommandPalette } from "@/components/command-palette"
import { KeyboardShortcutsModal } from "@/components/keyboard-shortcuts-modal"
import { PresenceBar } from "@/components/presence-bar"
import { useKeyboardNav } from "@/hooks/useKeyboardNav"
import { usePRRoom } from "@/hooks/use-pr-room"
import { useRateLimitExhausted } from "@/components/RateLimitBar"

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
  rankingData: { ranked_files: RankedFileData[]; processing_ms?: number } | null
  clusterData: { groups: ClusterData[] } | null
  prTitle: string
  prId?: string
  owner?: string
  repo?: string
  currentUser?: { name: string; image?: string }
}

export function PRReviewView({ files, rankingData, clusterData, prTitle, prId, owner, repo, currentUser }: PRReviewViewProps) {
  const router = useRouter()
  const [selectedFile, setSelectedFile] = useState<string | null>(files[0]?.filename ?? null)
  const [viewMode, setViewMode] = useState<"unified" | "split">("unified")
  const [reviewOrder, setReviewOrder] = useState(false)
  const [selectedCluster, setSelectedCluster] = useState<number | null>(null)
  const [showPalette, setShowPalette] = useState(false)
  const [showShortcuts, setShowShortcuts] = useState(false)
  const [commentLineOpen, setCommentLineOpen] = useState<number | null>(null)
  const [criticalBannerDismissed, setCriticalBannerDismissed] = useState(false)
  const [activeTab, setActiveTab] = useState<"diff" | "timeline">("diff")
  const [fileTreeOpen, setFileTreeOpen] = useState(false)

  const rateLimitExhausted = useRateLimitExhausted()

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

  const { focusedFile } = useKeyboardNav(
    fileNames,
    handleSelectFile,
    () => setCommentLineOpen(0)
  )

  // Native listeners for ⌘K, ?, Escape — avoids stale closure / recreation issues
  const showPaletteRef = useRef(showPalette)
  const showShortcutsRef = useRef(showShortcuts)
  showPaletteRef.current = showPalette
  showShortcutsRef.current = showShortcuts

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      const tag = target?.tagName?.toLowerCase()

      if (e.key === "k" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault()
        setShowPalette(true)
      } else if (e.key === "?" && !e.ctrlKey && !e.metaKey) {
        // Allow shift since ? requires shift on most keyboards
        if (tag !== "input" && tag !== "textarea" && target?.getAttribute("contenteditable") !== "true") {
          e.preventDefault()
          setShowShortcuts(true)
        }
      } else if (e.key === "Escape") {
        setShowPalette(false)
        setShowShortcuts(false)
        setCommentLineOpen(null)
      }
    }

    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [])

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

  // Critical files for banner
  const criticalFiles = useMemo(
    () => enrichedFiles.filter(f => f.label === "Critical"),
    [enrichedFiles]
  )

  // Cluster color for highlighting
  const selectedClusterIndex = useMemo(() => {
    if (selectedCluster == null || !clusterData) return null
    return clusterData.groups.findIndex(g => g.cluster_id === selectedCluster)
  }, [selectedCluster, clusterData])

  const clusterHighlightColor = selectedClusterIndex != null && selectedClusterIndex >= 0
    ? CLUSTER_BORDER_COLORS[selectedClusterIndex % CLUSTER_BORDER_COLORS.length]
    : null

  // Processing ms from ranking data
  const processingMs = rankingData?.processing_ms

  return (
    <div className="flex h-[calc(100vh-57px)] overflow-hidden">
      {/* Mobile backdrop */}
      {fileTreeOpen && (
        <div
          className="md:hidden fixed inset-0 z-40 bg-background/60 backdrop-blur-sm animate-fade-in"
          onClick={() => setFileTreeOpen(false)}
        />
      )}

      {/* Left panel: file list + cluster panel */}
      <div className={`
        border-border flex flex-col shrink-0
        md:static md:w-72 md:border-r md:translate-y-0 md:flex
        fixed bottom-0 left-0 right-0 z-50 h-[70vh] border-t
        bg-background
        transition-transform duration-300 ease-in-out
        ${fileTreeOpen ? "translate-y-0" : "translate-y-full"}
      `}>
        {/* Mobile drag handle / close */}
        <div className="md:hidden flex items-center justify-between px-4 py-2 border-b border-border">
          <div className="w-8 h-1 bg-muted-foreground/30 rounded-full mx-auto" />
          <button
            className="ml-auto text-muted-foreground hover:text-foreground transition-colors p-1"
            onClick={() => setFileTreeOpen(false)}
            aria-label="Close file tree"
          >
            ✕
          </button>
        </div>

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
            clusterHighlightColor={clusterHighlightColor}
          />
        </div>

        {/* ML latency display */}
        {processingMs != null && (
          <div className="px-3 py-1.5 border-t border-border">
            <span className="text-[10px] text-muted-foreground/60">
              AI ranked in {processingMs < 50 ? "< 50ms" : `${processingMs}ms`}
            </span>
          </div>
        )}
      </div>

      {/* Right panel: diff viewer + tabs */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        {/* Mobile toolbar: hamburger + current file name */}
        <div className="md:hidden flex items-center gap-2 px-3 py-2 border-b border-border shrink-0">
          <button
            className="p-2 rounded hover:bg-muted transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center"
            onClick={() => setFileTreeOpen(true)}
            aria-label="Show file tree"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
            </svg>
          </button>
          <span className="text-sm text-muted-foreground truncate font-mono">
            {selectedFile ?? "Select a file"}
          </span>
        </div>

        {/* Rate limit warning */}
        {rateLimitExhausted && (
          <div className="px-4 py-2 bg-amber-500/10 border-b border-amber-500/20 text-xs text-amber-400 text-center">
            Rate limited — resets soon. GitHub API calls are paused.
          </div>
        )}

        {/* Critical files banner */}
        {reviewOrder && criticalFiles.length > 0 && !criticalBannerDismissed && (
          <div className="mx-4 mt-3 flex items-start gap-2 px-3 py-2 rounded bg-blue-500/10 border border-blue-500/30 text-xs text-blue-400 animate-slide-in-top">
            <svg className="w-3.5 h-3.5 shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
            </svg>
            <span className="flex-1">
              AI recommends reviewing these {criticalFiles.length} file(s) first:{" "}
              <span className="font-mono">{criticalFiles.map(f => f.filename).join(", ")}</span>
            </span>
            <button
              onClick={() => setCriticalBannerDismissed(true)}
              className="shrink-0 hover:text-blue-200 transition-colors"
              aria-label="Dismiss"
            >
              ✕
            </button>
          </div>
        )}

        {/* Tab bar */}
        <div className="flex items-center gap-0 border-b border-border px-4 pt-2">
          <button
            className={`text-xs px-3 py-1.5 border-b-2 transition-colors ${activeTab === "diff" ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
            onClick={() => setActiveTab("diff")}
          >
            Diff
          </button>
          <button
            className={`text-xs px-3 py-1.5 border-b-2 transition-colors ${activeTab === "timeline" ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
            onClick={() => setActiveTab("timeline")}
          >
            Timeline
          </button>
        </div>

        <div className="flex-1 overflow-y-auto pb-10">
          {activeTab === "timeline" && owner && repo && prId ? (
            <Timeline owner={owner} repo={repo} number={prId} />
          ) : (
            <>
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
                    commentOpen={commentLineOpen !== null}
                  />
                </div>
              ) : (
                <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
                  Select a file to view its diff
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Keyboard shortcut hints bar — hidden on mobile */}
      <div className="hidden md:flex fixed bottom-0 left-0 right-0 z-40 border-t border-border bg-background/80 backdrop-blur-sm px-4 py-1.5 items-center gap-4 text-[10px] text-muted-foreground">
        <span><kbd className="font-mono bg-muted border border-border rounded px-1">j</kbd> <kbd className="font-mono bg-muted border border-border rounded px-1">k</kbd> navigate</span>
        <span><kbd className="font-mono bg-muted border border-border rounded px-1">c</kbd> comment</span>
        <span><kbd className="font-mono bg-muted border border-border rounded px-1">⌘K</kbd> search</span>
        <span><kbd className="font-mono bg-muted border border-border rounded px-1">?</kbd> shortcuts</span>
        <span><kbd className="font-mono bg-muted border border-border rounded px-1">g</kbd><kbd className="font-mono bg-muted border border-border rounded px-1">d</kbd> dashboard</span>
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
