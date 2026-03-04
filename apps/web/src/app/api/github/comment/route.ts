import { NextRequest, NextResponse } from "next/server"
import { getSession } from "@/lib/session"

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { accessToken } = session
  const { owner, repo, pr_number, body, commit_id, path, line } = await req.json()

  try {
    const res = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/pulls/${pr_number}/comments`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          Accept: "application/vnd.github+json",
        },
        body: JSON.stringify({ body, commit_id, path, line, side: "RIGHT" }),
      }
    )

    const data = await res.json()
    if (!res.ok) {
      return NextResponse.json({ error: data.message ?? "GitHub API error" }, { status: res.status })
    }

    return NextResponse.json({ success: true, comment_id: data.id })
  } catch {
    return NextResponse.json({ error: "Failed to post comment" }, { status: 500 })
  }
}
