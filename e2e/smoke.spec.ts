import { expect, test } from '@playwright/test'

const LANDING_CTA = '新規申請或會員登入'

/** 不需登入：確認 SPA 可載入、驗證 Playwright 與 dev server 管線 */
test('landing loads', async ({ page }) => {
  const res = await page.goto('/')
  expect(res?.ok()).toBeTruthy()
  await expect(page.getByRole('button', { name: LANDING_CTA })).toBeVisible({ timeout: 45_000 })
})

/** YouTube／廣告落地頁：/join 須能直接開啟且顯示相同 CTA */
test('/join ad landing loads', async ({ page }) => {
  const res = await page.goto('/join')
  expect(res?.ok()).toBeTruthy()
  await expect(page.getByRole('button', { name: LANDING_CTA })).toBeVisible({ timeout: 45_000 })
  await expect(page).toHaveTitle(/加入 tsMedia/)
})
