export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center">
      <div className="text-center space-y-4">
        <h1 className="text-2xl font-bold">CodeLens</h1>
        <p className="text-muted-foreground">AI-powered code review</p>
        <a
          href="/api/auth/login"
          className="inline-flex items-center gap-2 rounded-md bg-gray-900 px-6 py-3 text-white hover:bg-gray-700"
        >
          Sign in with GitHub
        </a>
      </div>
    </main>
  )
}
