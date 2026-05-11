import { expect, test } from '@playwright/test'

/** 不需登入：確認 SPA 可載入、驗證 Playwright 與 dev server 管線 */
test('landing loads', async ({ page }) => {
  const res = await page.goto('/')
  expect(res?.ok()).toBeTruthy()
  await expect(page.locator('body')).toBeVisible()
})
