import { redirect } from "next/navigation"
import { getSession } from "@/lib/session"
import { Octokit } from "@octokit/rest"
import { PRReviewView } from "@/components/pr-review/pr-review-view"
import { ErrorBoundary } from "@/components/error-boundary"

interface PageProps {
  params: Promise<{ owner: string; repo: string; number: string }>
}

async function fetchPRData(accessToken: string, owner: string, repo: string, number: number) {
  const octokit = new Octokit({ auth: accessToken })

  const [prResp, filesResp] = await Promise.all([
    octokit.pulls.get({ owner, repo, pull_number: number }),
    octokit.pulls.listFiles({ owner, repo, pull_number: number, per_page: 100 }),
  ])

  return {
    pr: prResp.data,
    files: filesResp.data.map((f: { filename: string; additions: number; deletions: number; patch?: string }) => ({
      filename: f.filename,
      additions: f.additions,
      deletions: f.deletions,
      patch: f.patch,
    })),
  }
}

async function fetchMLData(files: { filename: string; additions: number; deletions: number; patch?: string }[], prId: string) {
  const mlApiUrl = process.env.ML_API_URL ?? "http://localhost:8000"

  const [rankingRes, clusterRes] = await Promise.allSettled([
    fetch(`${mlApiUrl}/rank`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pr_id: prId, repo: "unknown", files }),
      signal: AbortSignal.timeout(5000),
    }).then(r => r.ok ? r.json() : null),
    fetch(`${mlApiUrl}/cluster`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pr_id: prId, files }),
      signal: AbortSignal.timeout(5000),
    }).then(r => r.ok ? r.json() : null),
  ])

  return {
    rankingData: rankingRes.status === "fulfilled" ? rankingRes.value : null,
    clusterData: clusterRes.status === "fulfilled" ? clusterRes.value : null,
  }
}

export default async function PRDetailPage({ params }: PageProps) {
  const { owner, repo, number } = await params
  const session = await getSession()

  if (!session) redirect("/login")

  const { accessToken } = session
  let prData = null
  let rankingData = null
  let clusterData = null

  try {
    prData = await fetchPRData(accessToken, owner, repo, parseInt(number, 10))
    const mlData = await fetchMLData(prData.files, number)
    rankingData = mlData.rankingData
    clusterData = mlData.clusterData
  } catch (e) {
    if (!prData) {
      return (
        <div className="max-w-4xl mx-auto px-6 py-8">
          <p className="text-destructive">Failed to load PR data.</p>
        </div>
      )
    }
  }

  return (
    <div>
      <div className="px-6 py-3 border-b border-border">
        <p className="text-xs text-muted-foreground">{owner}/{repo}</p>
        <h1 className="text-lg font-semibold">{prData?.pr.title ?? `PR #${number}`}</h1>
      </div>

      <ErrorBoundary>
        <PRReviewView
          files={prData?.files ?? []}
          rankingData={rankingData}
          clusterData={clusterData}
          prTitle={prData?.pr.title ?? ""}
          prId={number}
          owner={owner}
          repo={repo}
          currentUser={session ? { name: session.user.name, image: session.user.avatar_url } : undefined}
        />
      </ErrorBoundary>
    </div>
  )
}
