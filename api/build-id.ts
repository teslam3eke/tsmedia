import type { VercelRequest, VercelResponse } from '@vercel/node'

/** GET /api/build-id — 回傳本次部署的 git SHA 前 12 碼（與 bundle 內 __APP_BUILD_ID__ 一致）。靜態 /build-id.txt 未上線時仍可做版本檢查。 */
export default function handler(_req: VercelRequest, res: VercelResponse): void {
  const sha = process.env.VERCEL_GIT_COMMIT_SHA?.trim()?.slice(0, 12)
  if (!sha) {
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
    .send(`${sha}\n`)
}
