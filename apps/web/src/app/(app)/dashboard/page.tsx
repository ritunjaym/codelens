import { redirect } from "next/navigation"
import { getSession } from "@/lib/session"
import { Octokit } from "@octokit/rest"
import { PRCard, PRCardData } from "@/components/pr-card"
import { ErrorBoundary } from "@/components/error-boundary"

const cachedFetch = (url: string, init?: RequestInit) =>
  fetch(url, { ...init, next: { revalidate: 60 } } as RequestInit)

async function fetchUserPRs(accessToken: string): Promise<PRCardData[]> {
  try {
    const octokit = new Octokit({ auth: accessToken, request: { fetch: cachedFetch } })

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
          <div className="text-center py-16 text-muted-foreground flex flex-col items-center gap-3">
            <svg className="w-12 h-12 opacity-30" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
            </svg>
            <p className="text-base font-medium">No open pull requests found</p>
            <p className="text-sm">Try selecting a different repository, or open a PR on GitHub to start reviewing with ML-powered insights.</p>
            <a
              href="https://github.com/pulls"
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1 text-xs px-3 py-1.5 rounded border border-border hover:bg-muted transition-colors"
            >
              View your PRs on GitHub →
            </a>
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
