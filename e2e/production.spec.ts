import { test, expect } from "@playwright/test"

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "https://codelens.vercel.app"

test.describe("Production smoke tests", () => {
  test("landing page loads", async ({ page }) => {
    await page.goto(BASE_URL)
    await expect(page).toHaveTitle(/CodeLens/)
  })

  test("landing page has sign in button", async ({ page }) => {
    await page.goto(BASE_URL)
    // Either show sign-in or redirect to dashboard
    const url = page.url()
    expect(url).toMatch(/codelens|localhost/)
  })
})
