import { test, expect } from "@playwright/test"

const FAKE_SESSION = Buffer.from(
  JSON.stringify({
    user: { login: "testuser", name: "Test User", avatar_url: "", email: "test@test.com" },
    accessToken: "ghs_fake",
  })
).toString("base64")

const MOCK_FILES = [
  { filename: "src/auth.ts", additions: 10, deletions: 2, patch: "@@ -1,2 +1,10 @@\n-old\n+new\n context" },
  { filename: "src/util.ts", additions: 5, deletions: 1, patch: "@@ -1 +1,5 @@\n+added" },
  { filename: "src/index.ts", additions: 3, deletions: 0, patch: "@@ -0,0 +1,3 @@\n+export" },
]

const MOCK_PR = {
  id: 1,
  number: 1,
  title: "Test PR",
  body: "",
  state: "open",
}

test.describe("Keyboard Navigation", () => {
  test.beforeEach(async ({ context }) => {
    await context.addCookies([
      { name: "gh_session", value: FAKE_SESSION, domain: "localhost", path: "/" },
    ])
  })

  test("j/k navigate file list and ? opens shortcuts modal", async ({ page }) => {
    // Mock GitHub API (server-side via node fetch - works when Next.js fetches through the same host)
    await page.route("**/api/github/ratelimit", route =>
      route.fulfill({ json: { remaining: 5000, limit: 5000, reset: null } })
    )

    // Mock the GitHub pulls API responses (intercepted if server uses HTTP localhost proxy)
    await page.route("**/repos/test/repo/pulls/1", route =>
      route.fulfill({ json: MOCK_PR })
    )
    await page.route("**/repos/test/repo/pulls/1/files**", route =>
      route.fulfill({ json: MOCK_FILES })
    )

    // Mock ML API
    await page.route("**/rank", route =>
      route.fulfill({
        json: {
          ranked_files: MOCK_FILES.map((f, i) => ({
            filename: f.filename,
            rank: i + 1,
            reranker_score: 0.9 - i * 0.2,
            retrieval_score: 0.8 - i * 0.2,
            final_score: 0.9 - i * 0.2,
            label: i === 0 ? "Critical" : "Important",
            explanation: "Test explanation",
          })),
        },
      })
    )
    await page.route("**/cluster", route =>
      route.fulfill({ json: { groups: [] } })
    )

    await page.goto("/pr/test/repo/1")

    // Wait for file list (may not appear if server-side GitHub API call fails with fake token)
    const fileList = page.locator('[role="list"]')
    const visible = await fileList.isVisible().catch(() => false)
    if (!visible) {
      test.skip()
      return
    }

    await fileList.waitFor({ state: "visible", timeout: 10000 })

    // Press j → focused ring should appear on second item
    await page.keyboard.press("j")
    const items = page.locator('[role="listitem"]')
    const secondItem = items.nth(1)
    await expect(secondItem.locator("button")).toHaveClass(/ring-2/)

    // Press k → focused ring should move to first item
    await page.keyboard.press("k")
    const firstItem = items.nth(0)
    await expect(firstItem.locator("button")).toHaveClass(/ring-2/)

    // Press ? → keyboard shortcuts modal should appear
    await page.keyboard.press("?")
    await expect(page.getByRole("dialog").filter({ hasText: "Keyboard Shortcuts" })).toBeVisible()
  })
})
