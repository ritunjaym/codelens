import { redirect } from "next/navigation"
import { getSession } from "@/lib/session"
import { Octokit } from "@octokit/rest"
import { PRCard, PRCardData } from "@/components/pr-card"
import { ErrorBoundary } from "@/components/error-boundary"

async function fetchUserPRs(accessToken: string): Promise<PRCardData[]> {
  try {
    const octokit = new Octokit({ auth: accessToken })

    const { data: repos } = await octokit.repos.listForAuthenticatedUser({
      sort: "pushed",
      direction: "desc",
      per_page: 10,
      type: "owner",
    })

    const allPRs: PRCardData[] = []

    await Promise.all(
      repos.slice(0, 5).map(async (repo: { name: string; owner: { login: string } }) => {
        try {
          const { data: prs } = await octokit.pulls.list({
            owner: repo.owner.login,
            repo: repo.name,
            state: "open",
            per_page: 10,
            sort: "updated",
            direction: "desc",
          })

          for (const pr of prs) {
            allPRs.push({
              number: pr.number,
              title: pr.title,
              repo: repo.name,
              owner: repo.owner.login,
              author: pr.user?.login ?? "unknown",
              authorAvatar: pr.user?.avatar_url ?? "",
              createdAt: pr.created_at,
              fileCount: 0,
              additions: 0,
              deletions: 0,
              isDraft: pr.draft ?? false,
            })
          }
        } catch {
          // Skip repos we can't access
        }
      })
    )

    return allPRs.sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    )
  } catch {
    return []
  }
}

export default async function DashboardPage() {
  const session = await getSession()
  if (!session) redirect("/login")
  const { accessToken } = session
  const prs = accessToken ? await fetchUserPRs(accessToken) : []

  return (
    <ErrorBoundary>
      <div className="max-w-4xl mx-auto px-6 py-8">
        <div className="mb-6">
          <h1 className="text-2xl font-bold">Open Pull Requests</h1>
          <p className="text-muted-foreground text-sm mt-1">
            {prs.length} open PRs across your repositories
          </p>
        </div>

        {prs.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground">
            <p className="text-lg font-medium">No open pull requests</p>
            <p className="text-sm mt-2">Open a PR on GitHub to start reviewing with ML-powered insights.</p>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-1 md:grid-cols-2">
            {prs.map((pr) => (
              <PRCard key={`${pr.owner}/${pr.repo}#${pr.number}`} pr={pr} />
            ))}
          </div>
        )}
      </div>
    </ErrorBoundary>
  )
}
