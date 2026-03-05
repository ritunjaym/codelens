import { NextRequest } from "next/server"
import { getSession } from "@/lib/session"
import { Octokit } from "@octokit/rest"

export async function GET(request: NextRequest) {
  const session = await getSession()
  if (!session) {
    return Response.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const owner = searchParams.get("owner")
  const repo = searchParams.get("repo")
  const number = searchParams.get("number")

  if (!owner || !repo || !number) {
    return Response.json({ error: "Missing params" }, { status: 400 })
  }

  const octokit = new Octokit({ auth: session.accessToken })
  const pullNumber = parseInt(number, 10)

  const [eventsRes, reviewsRes] = await Promise.allSettled([
    octokit.issues.listEvents({ owner, repo, issue_number: pullNumber }),
    octokit.pulls.listReviews({ owner, repo, pull_number: pullNumber }),
  ])

  const events =
    eventsRes.status === "fulfilled"
      ? eventsRes.value.data.map((e) => ({
          id: `event-${e.id}`,
          type: "event" as const,
          event: e.event,
          actor: e.actor
            ? { login: e.actor.login, avatar_url: e.actor.avatar_url }
            : null,
          created_at: e.created_at ?? new Date().toISOString(),
        }))
      : []

  const reviews =
    reviewsRes.status === "fulfilled"
      ? reviewsRes.value.data.map((r) => ({
          id: `review-${r.id}`,
          type: "review" as const,
          event: `review_${r.state.toLowerCase()}`,
          actor: r.user
            ? { login: r.user.login, avatar_url: r.user.avatar_url }
            : null,
          created_at: r.submitted_at ?? new Date().toISOString(),
          body: r.body ?? undefined,
          state: r.state,
        }))
      : []

  const timeline = [...events, ...reviews].sort(
    (a, b) =>
      new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  )

  return Response.json({ timeline })
}
