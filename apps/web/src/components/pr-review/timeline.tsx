"use client"

import useSWR from "swr"
import { formatDistanceToNow } from "date-fns"

interface TimelineActor {
  login: string
  avatar_url: string
}

interface TimelineItem {
  id: string
  type: "event" | "review"
  event: string
  actor: TimelineActor | null
  created_at: string
  body?: string
  state?: string
}

interface TimelineProps {
  owner: string
  repo: string
  number: string
}

const fetcher = (url: string) => fetch(url).then((r) => r.json())

function eventLabel(item: TimelineItem): string {
  switch (item.event) {
    case "opened":
      return "opened this PR"
    case "closed":
      return "closed this PR"
    case "merged":
      return "merged this PR"
    case "committed":
      return "pushed commits"
    case "review_approved":
      return "approved this PR"
    case "review_changes_requested":
      return "requested changes"
    case "review_commented":
      return "reviewed"
    case "review_dismissed":
      return "dismissed a review"
    case "labeled":
      return "added a label"
    case "unlabeled":
      return "removed a label"
    case "assigned":
      return "was assigned"
    case "unassigned":
      return "was unassigned"
    case "review_requested":
      return "requested a review"
    case "review_request_removed":
      return "removed a review request"
    case "commented":
      return "commented"
    default:
      return item.event.replace(/_/g, " ")
  }
}

function eventIcon(item: TimelineItem): string {
  if (item.type === "review") {
    if (item.state === "APPROVED") return "✅"
    if (item.state === "CHANGES_REQUESTED") return "🔴"
    return "💬"
  }
  switch (item.event) {
    case "merged":
      return "🔀"
    case "closed":
      return "❌"
    case "committed":
      return "📝"
    case "labeled":
    case "unlabeled":
      return "🏷"
    case "assigned":
      return "👤"
    default:
      return "•"
  }
}

export function Timeline({ owner, repo, number }: TimelineProps) {
  const { data, isLoading } = useSWR<{ timeline: TimelineItem[] }>(
    `/api/github/timeline?owner=${owner}&repo=${repo}&number=${number}`,
    fetcher
  )

  if (isLoading) {
    return (
      <div className="p-4 space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3">
            <div className="w-6 h-6 rounded-full bg-muted animate-pulse shrink-0" />
            <div className="flex-1 space-y-1">
              <div className="h-3 bg-muted animate-pulse rounded w-48" />
              <div className="h-2 bg-muted animate-pulse rounded w-24" />
            </div>
          </div>
        ))}
      </div>
    )
  }

  const timeline = data?.timeline ?? []

  if (timeline.length === 0) {
    return (
      <div className="flex items-center justify-center h-full py-16 text-muted-foreground text-sm">
        No activity yet
      </div>
    )
  }

  return (
    <div className="p-4 space-y-3">
      <h3 className="text-sm font-semibold mb-4">PR Activity</h3>
      <div className="relative">
        <div className="absolute left-3 top-0 bottom-0 w-px bg-border" />
        <div className="space-y-4">
          {timeline.map((item) => (
            <div key={item.id} className="flex items-start gap-3 pl-8 relative">
              <span className="absolute left-1.5 text-xs" style={{ top: "2px" }}>
                {eventIcon(item)}
              </span>
              {item.actor && (
                <img
                  src={item.actor.avatar_url}
                  alt={item.actor.login}
                  className="w-5 h-5 rounded-full shrink-0 mt-0.5"
                />
              )}
              <div className="min-w-0">
                <p className="text-xs">
                  <span className="font-medium">
                    {item.actor?.login ?? "GitHub"}
                  </span>{" "}
                  <span className="text-muted-foreground">{eventLabel(item)}</span>
                </p>
                {item.body && (
                  <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                    {item.body}
                  </p>
                )}
                <p className="text-[10px] text-muted-foreground/60 mt-0.5">
                  {formatDistanceToNow(new Date(item.created_at), {
                    addSuffix: true,
                  })}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
