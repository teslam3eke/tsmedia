import { expect, test, type Page } from '@playwright/test'

/** 本地 dev server；可由 playwright.config 的 E2E_BASE_URL 覆寫 */
const LOCAL_DEV_URL = process.env.E2E_BASE_URL ?? 'http://localhost:5173'

const BACKGROUND_HOLD_MS = 5_000
/** 回前景後 Loading 轉圈不得超過此時間（毫秒） */
const SPINNER_MAX_VISIBLE_MS = 2_000

function discoverLoading(page: Page) {
  return page.getByText('載入今日探索名單')
}

function matchesLoading(page: Page) {
  return page.getByText('載入配對')
}

async function assertNoBlockingLoaders(page: Page) {
  await expect(discoverLoading(page)).toBeHidden()
  await expect(matchesLoading(page)).toBeHidden()
}

/** 模擬 PWA／分頁切到背景或回到前景（觸發 App visibility 監聽） */
async function setDocumentVisibility(page: Page, state: 'hidden' | 'visible') {
  await page.evaluate((next) => {
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => next,
    })
    document.dispatchEvent(new Event('visibilitychange'))
  }, state)
}

async function enterMainShell(page: Page) {
  await page.goto(`${LOCAL_DEV_URL}/?tab=discover`)

  const skipDemo = page.getByRole('button', { name: '跳過（測試模式）' })
  if (await skipDemo.isVisible({ timeout: 20_000 }).catch(() => false)) {
    await skipDemo.click()
  }

  await expect(page.getByRole('button', { name: '探索' })).toBeVisible({ timeout: 30_000 })
}

async function assertDiscoverContentVisible(page: Page) {
  await expect(page.getByRole('heading', { name: '探索' })).toBeVisible()
  await expect(page.getByText(/\d+ \/ \d+/).first()).toBeVisible()
  await expect(page.locator('span.text-\\[2rem\\]').first()).toBeVisible()
}

async function assertMatchesContentVisible(page: Page) {
  await expect(page.getByRole('heading', { name: '配對' })).toBeVisible()
  await expect(
    page.getByRole('button', { name: '開始聊天' }).first().or(page.getByText('尚未有配對')),
  ).toBeVisible()
}

test.describe('PWA 背景／前景', () => {
  test('切換背景再回來時，探索與配對不應卡死轉圈', async ({ page, baseURL }) => {
    test.info().annotations.push({
      type: 'target',
      description: baseURL ?? LOCAL_DEV_URL,
    })

    await enterMainShell(page)

    // ── 初始狀態：已渲染、無全螢幕 Loading ──
    await assertNoBlockingLoaders(page)
    await assertDiscoverContentVisible(page)

    // ── 探索分頁：模擬切換背景 5 秒 ──
    await setDocumentVisibility(page, 'hidden')
    await page.waitForTimeout(BACKGROUND_HOLD_MS)

    await setDocumentVisibility(page, 'visible')

    await expect(discoverLoading(page)).toBeHidden({ timeout: SPINNER_MAX_VISIBLE_MS })
    await expect(matchesLoading(page)).toBeHidden({ timeout: SPINNER_MAX_VISIBLE_MS })
    await assertDiscoverContentVisible(page)

    // ── 配對名單分頁：同樣情境 ──
    await page.getByRole('button', { name: '配對', exact: true }).click()
    await assertNoBlockingLoaders(page)
    await assertMatchesContentVisible(page)

    await setDocumentVisibility(page, 'hidden')
    await page.waitForTimeout(BACKGROUND_HOLD_MS)

    await setDocumentVisibility(page, 'visible')

    await expect(matchesLoading(page)).toBeHidden({ timeout: SPINNER_MAX_VISIBLE_MS })
    await expect(discoverLoading(page)).toBeHidden({ timeout: SPINNER_MAX_VISIBLE_MS })
    await assertMatchesContentVisible(page)
  })
})
