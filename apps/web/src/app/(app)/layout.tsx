import { redirect } from "next/navigation"
import { getSession } from "@/lib/session"
import { RateLimitBar } from "@/components/RateLimitBar"

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession()

  if (!session) {
    redirect("/login")
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border px-6 py-3 flex items-center justify-between">
        <a href="/dashboard" className="font-semibold text-lg">CodeLens</a>
        <div className="flex items-center gap-4">
          <RateLimitBar />
          <span className="text-sm text-muted-foreground">{session.user.name}</span>
          <a
            href="/api/auth/logout"
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            Sign out
          </a>
        </div>
      </header>
      <main id="main-content">{children}</main>
    </div>
  )
}
