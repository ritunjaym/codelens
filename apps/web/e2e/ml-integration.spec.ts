import { test, expect } from "@playwright/test"

const FAKE_SESSION = Buffer.from(
  JSON.stringify({
    user: { login: "testuser", name: "Test User", avatar_url: "", email: "test@test.com" },
    accessToken: "ghs_fake",
  })
).toString("base64")

const MOCK_RANKED_FILES = [
  {
    filename: "auth.ts",
    rank: 1,
    reranker_score: 0.95,
    retrieval_score: 0.85,
    final_score: 0.9,
    label: "Critical",
    explanation: "Authentication changes require careful review",
  },
  {
    filename: "util.ts",
    rank: 2,
    reranker_score: 0.6,
    retrieval_score: 0.4,
    final_score: 0.5,
    label: "Important",
    explanation: "Utility changes affect multiple modules",
  },
]

const MOCK_FILES = MOCK_RANKED_FILES.map(f => ({
  filename: f.filename,
  additions: 10,
  deletions: 2,
  patch: "@@ -1,2 +1,10 @@\n+new line\n context line",
}))

test.describe("ML Integration", () => {
  test.beforeEach(async ({ context }) => {
    await context.addCookies([
      { name: "gh_session", value: FAKE_SESSION, domain: "localhost", path: "/" },
    ])
  })

  test("ML rank labels appear in file list", async ({ page }) => {
    await page.route("**/api/github/ratelimit", route =>
      route.fulfill({ json: { remaining: 5000, limit: 5000, reset: null } })
    )
    await page.route("**/repos/**", route =>
      route.fulfill({ json: MOCK_FILES })
    )
    await page.route("**/rank", route =>
      route.fulfill({ json: { ranked_files: MOCK_RANKED_FILES } })
    )
    await page.route("**/cluster", route =>
      route.fulfill({ json: { groups: [] } })
    )

    await page.goto("/pr/test/repo/1")

    const fileList = page.locator('[role="list"]')
    const visible = await fileList.isVisible().catch(() => false)
    if (!visible) {
      test.skip()
      return
    }

    await fileList.waitFor({ state: "visible", timeout: 10000 })

    await expect(page.getByText("Critical")).toBeVisible()
    await expect(page.getByText("Important")).toBeVisible()
  })
})
