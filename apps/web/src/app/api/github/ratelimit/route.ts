import { NextResponse } from "next/server"
import { getSession } from "@/lib/session"

export async function GET() {
  const session = await getSession()

  if (!session) {
    return NextResponse.json({ remaining: 5000, limit: 5000, reset: null })
  }

  try {
    const res = await fetch("https://api.github.com/rate_limit", {
      headers: {
        Authorization: `Bearer ${session.accessToken}`,
        Accept: "application/vnd.github+json",
      },
    })

    const data = await res.json()
    const core = data.resources?.core ?? data.rate ?? {}

    return NextResponse.json({
      remaining: core.remaining ?? 5000,
      limit: core.limit ?? 5000,
      reset: core.reset ?? null,
    })
  } catch {
    return NextResponse.json({ remaining: 5000, limit: 5000, reset: null })
  }
}
