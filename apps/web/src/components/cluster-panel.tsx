"use client"

interface Cluster {
  cluster_id: number
  label: string
  files: string[]
  coherence: number
}

interface ClusterPanelProps {
  clusters: Cluster[]
  selectedClusterId: number | null
  onSelectCluster: (id: number | null) => void
}

export const CLUSTER_COLORS = [
  "bg-purple-500", "bg-blue-500", "bg-cyan-500", "bg-teal-500",
  "bg-indigo-500", "bg-violet-500", "bg-fuchsia-500", "bg-pink-500",
]

export const CLUSTER_BORDER_COLORS = [
  "border-purple-500", "border-blue-500", "border-cyan-500", "border-teal-500",
  "border-indigo-500", "border-violet-500", "border-fuchsia-500", "border-pink-500",
]

export function ClusterPanel({ clusters, selectedClusterId, onSelectCluster }: ClusterPanelProps) {
  if (clusters.length === 0) {
    return (
      <div className="p-3 text-xs text-muted-foreground text-center">
        Semantic groups unavailable
      </div>
    )
  }

  return (
    <div className="p-3 space-y-1">
      <div className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wide">
        Semantic Groups
      </div>
      
      <button
        className={`w-full text-left px-2 py-1.5 rounded text-xs transition-colors ${selectedClusterId === null ? "bg-muted font-medium" : "hover:bg-muted/50"}`}
        onClick={() => onSelectCluster(null)}
      >
        All files
      </button>
      
      {clusters.map((cluster, i) => {
        const isSelected = selectedClusterId === cluster.cluster_id
        const color = CLUSTER_COLORS[i % CLUSTER_COLORS.length]
        
        return (
          <button
            key={cluster.cluster_id}
            className={`w-full text-left px-2 py-1.5 rounded text-xs transition-colors flex items-start gap-2 ${isSelected ? "bg-muted font-medium" : "hover:bg-muted/50"}`}
            onClick={() => onSelectCluster(isSelected ? null : cluster.cluster_id)}
            aria-pressed={isSelected}
          >
            <span className={`mt-0.5 w-2 h-2 rounded-full shrink-0 ${color}`} />
            <span className="flex-1 min-w-0">
              <span className="block truncate">{cluster.label}</span>
              <span className="text-[10px] text-muted-foreground">
                {cluster.files.length} files · {(cluster.coherence * 100).toFixed(0)}% coherence
              </span>
            </span>
          </button>
        )
      })}
    </div>
  )
}
