/**
 * 以真實皇冠 PNG（黑底舞台合成）截圖三種皇冠廣告圖。
 * npx tsx scripts/capture-crown-ad-screenshots.ts
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT_DIR = path.join(ROOT, 'public', 'assets', 'images', 'ads')
const PORT = 8792

const FORMATS = [
  { format: 'square', filename: 'ad-crown-three-tiers-square.png', width: 1080, height: 1920 },
  { format: 'story', filename: 'ad-crown-three-tiers-story.png', width: 1080, height: 1920 },
  { format: 'feed', filename: 'ad-crown-three-tiers-feed.png', width: 1080, height: 1920 },
] as const

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
    await waitForServer(`http://127.0.0.1:${PORT}/ad-preview/crown-three-tiers.html`)

    const browser = await chromium.launch()

    for (const { format, filename, width, height } of FORMATS) {
      const page = await browser.newPage({
        viewport: { width, height },
        deviceScaleFactor: 1,
      })
      await page.goto(`http://127.0.0.1:${PORT}/ad-preview/crown-three-tiers.html?format=${format}`, {
        waitUntil: 'networkidle',
      })
      await page.waitForTimeout(600)
      await page.locator(`#root > div`).screenshot({
        path: path.join(OUT_DIR, filename),
      })
      console.log(`✓ ${filename} (${width}×${height})`)
      await page.close()
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
