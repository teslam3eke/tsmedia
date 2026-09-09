/**
 * 以真實 App 排版 + blur(10px) 霧化截圖探索 DECK 廣告圖。
 * npx tsx scripts/capture-discover-ad-screenshots.ts
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT_DIR = path.join(ROOT, 'public', 'assets', 'images', 'ads')
const PORT = 8791
const VIEWPORT = { width: 390, height: 844 }

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
    await waitForServer(`http://127.0.0.1:${PORT}/ad-preview/discover-deck.html`)

    const browser = await chromium.launch()
    const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 2 })

    for (const [crown, filename] of [
      ['diamond', 'ad-discover-deck-with-diamond-crown.png'],
      ['none', 'ad-discover-deck-without-crown.png'],
    ] as const) {
      const query = crown === 'diamond' ? 'crown=diamond' : 'crown=none'
      await page.goto(`http://127.0.0.1:${PORT}/ad-preview/discover-deck.html?${query}`, {
        waitUntil: 'networkidle',
      })
      await page.waitForTimeout(500)
      await page.screenshot({
        path: path.join(OUT_DIR, filename),
        fullPage: false,
      })
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
