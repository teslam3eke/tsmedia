/**
 * 將 acquisition 48h / 7d 付費折價 mock 匯出為 PNG。
 * npx tsx scripts/capture-acquisition-coupon-paywall-mocks.ts
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT_DIR = path.join(ROOT, 'public', 'ad-preview')
const PORT = 8792
const HTML = 'acquisition-coupon-paywall-mocks.html'

function waitForServer(url: string, timeoutMs = 60_000): Promise<void> {
  const start = Date.now()
  return new Promise((resolve, reject) => {
    const tick = async () => {
      try {
        const res = await fetch(url)
        if (res.ok) {
          resolve()
          return
        }
      } catch {
        // retry
      }
      if (Date.now() - start > timeoutMs) {
        reject(new Error(`Server not ready: ${url}`))
        return
      }
      setTimeout(tick, 400)
    }
    tick()
  })
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true })

  const vite = spawn(
    process.platform === 'win32' ? 'npx.cmd' : 'npx',
    ['vite', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'],
    { cwd: ROOT, stdio: 'ignore', shell: process.platform === 'win32' },
  )

  try {
    const pageUrl = `http://127.0.0.1:${PORT}/ad-preview/${HTML}`
    await waitForServer(pageUrl)

    const browser = await chromium.launch()
    const page = await browser.newPage({
      viewport: { width: 960, height: 980 },
      deviceScaleFactor: 2,
    })

    await page.goto(pageUrl, { waitUntil: 'networkidle' })
    await page.waitForTimeout(800)

    const shots: [string, string][] = [
      ['#mock-48h', 'acquisition-coupon-paywall-48h-200.png'],
      ['#mock-7d', 'acquisition-coupon-paywall-7d-30pct.png'],
    ]

    for (const [selector, filename] of shots) {
      const loc = page.locator(selector)
      await loc.waitFor({ state: 'visible' })
      await loc.screenshot({ path: path.join(OUT_DIR, filename) })
      console.log(`✓ ${filename}`)
    }

    await browser.close()
  } finally {
    vite.kill('SIGTERM')
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
