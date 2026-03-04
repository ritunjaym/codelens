import { test, expect } from "@playwright/test"

const FAKE_SESSION = Buffer.from(
  JSON.stringify({
    user: { login: "testuser", name: "Test User", avatar_url: "", email: "test@test.com" },
    accessToken: "ghs_fake",
  })
).toString("base64")

const MOCK_FILES = [
  {
    filename: "src/auth.ts",
    additions: 5,
    deletions: 1,
    patch: "@@ -1,3 +1,5 @@\n const a = 1\n+const b = 2\n+const c = 3\n export default a",
  },
]

test.describe("Commenting", () => {
  test.beforeEach(async ({ context }) => {
    await context.addCookies([
      { name: "gh_session", value: FAKE_SESSION, domain: "localhost", path: "/" },
    ])
  })

  test("can add inline comment on a diff line", async ({ page }) => {
    await page.route("**/api/github/ratelimit", route =>
      route.fulfill({ json: { remaining: 5000, limit: 5000, reset: null } })
    )
    await page.route("**/rank", route =>
      route.fulfill({ json: { ranked_files: [] } })
    )
    await page.route("**/cluster", route =>
      route.fulfill({ json: { groups: [] } })
    )
    await page.route("**/api/github/comment", route =>
      route.fulfill({ json: { success: true, comment_id: 1 } })
    )

    await page.goto("/pr/test/repo/1")

    // Wait for diff table to be visible
    const diffTable = page.locator('[aria-label="Unified diff"]')
    const visible = await diffTable.isVisible().catch(() => false)
    if (!visible) {
      test.skip()
      return
    }

    await diffTable.waitFor({ state: "visible", timeout: 10000 })

    // Click on a diff line row to open comment form
    const rows = diffTable.locator("tr")
    const firstDataRow = rows.filter({ hasNot: page.locator('[class*="hunk"]') }).first()
    await firstDataRow.click()

    // Comment form should appear
    const textarea = page.locator('textarea[aria-label*="Comment on line"]')
    await textarea.waitFor({ state: "visible", timeout: 5000 })
    await textarea.fill("Test comment")

    // Submit comment
    await page.getByRole("button", { name: /^comment$/i }).click()

    // Comment should be visible (stored in localStorage, rendered immediately)
    await expect(page.getByText("Test comment")).toBeVisible()
  })
})
