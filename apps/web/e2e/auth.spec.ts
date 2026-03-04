import { test, expect } from "@playwright/test"

test("GET / redirects to /login and shows sign in button", async ({ page }) => {
  await page.context().clearCookies()
  await page.goto("/")
  await expect(page).toHaveURL(/\/login/)
  await expect(page.getByRole("button", { name: /sign in with github/i })).toBeVisible()
})

test("GET /dashboard without session redirects to /login", async ({ page }) => {
  await page.context().clearCookies()
  await page.goto("/dashboard")
  await expect(page).toHaveURL(/\/login/)
})
