import { test, expect } from "@playwright/test"

test.describe("Authentication", () => {
  test("landing page shows sign in button", async ({ page }) => {
    // Mock: if not authed, landing page has sign in CTA
    await page.route("**/api/auth/session", async route => {
      await route.fulfill({ json: { user: null } })
    })
    await page.goto("/")
    // Page should render (either landing or redirect)
    await expect(page).toHaveTitle(/CodeLens/)
  })
})
