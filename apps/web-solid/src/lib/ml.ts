const ML_BASE = import.meta.env.VITE_ML_API_URL || 'https://ritunjaym-codelens-api.hf.space'

export interface RankedFile {
  filename: string
  final_score: number
  reranker_score: number
  label: 'Critical' | 'Important' | 'Low'
  explanation: string
  processing_ms?: number
}

export interface Cluster {
  id: string
  label: string
  files: string[]
  coherence: number
  color: string
}

export const mlApi = {
  async rankFiles(
    prId: string,
    repo: string,
    files: Array<{ filename: string; patch?: string; additions: number; deletions: number }>
  ): Promise<{ ranked: RankedFile[]; processing_ms: number }> {
    try {
      const res = await fetch(`${ML_BASE}/rank`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pr_id: prId, repo, files }),
        signal: AbortSignal.timeout(15_000),
      })
      if (!res.ok) throw new Error('ML API error')
      const data = await res.json()
      return { ranked: data.ranked_files, processing_ms: data.processing_ms ?? 0 }
    } catch {
      return {
        ranked: files.map((f, i) => ({
          filename: f.filename,
          final_score: 1 - (i / files.length),
          reranker_score: 1 - (i / files.length),
          label: i === 0 ? 'Critical' : i < 3 ? 'Important' : 'Low',
          explanation: 'Heuristic fallback',
        })),
        processing_ms: 0,
      }
    }
  },

  async clusterFiles(
    prId: string,
    files: Array<{ filename: string; patch?: string }>
  ): Promise<Cluster[]> {
    try {
      const res = await fetch(`${ML_BASE}/cluster`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pr_id: prId, files }),
        signal: AbortSignal.timeout(15_000),
      })
      if (!res.ok) throw new Error()
      const data = await res.json()
      return data.groups ?? []
    } catch {
      return []
    }
  },
}
