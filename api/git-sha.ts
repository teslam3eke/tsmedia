import fs from 'fs'
import path from 'path'
import type { VercelRequest, VercelResponse } from '@vercel/node'

/** 讀取 package.json version（與 bundle 內 __APP_VERSION__ / build-id.txt 一致）。 */
function readAppReleaseVersion(): string | null {
  try {
    const pkgPath = path.join(process.cwd(), 'package.json')
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as { version?: string }
    const v = pkg.version?.trim()
    return v || null
  } catch {
    return null
  }
}

/** GET /api/git-sha — 回傳語意化版本（例如 1.0.1）；路徑名稱沿用舊版。 */
export default function handler(_req: VercelRequest, res: VercelResponse): void {
  const version = readAppReleaseVersion()
  if (!version) {
    res
      .status(503)
      .setHeader('Cache-Control', 'no-store')
      .setHeader('Content-Type', 'text/plain; charset=utf-8')
      .send('build-id-unavailable\n')
    return
  }
  res
    .status(200)
    .setHeader('Cache-Control', 'no-store, max-age=0, must-revalidate')
    .setHeader('Content-Type', 'text/plain; charset=utf-8')
    .send(`${version}\n`)
}
