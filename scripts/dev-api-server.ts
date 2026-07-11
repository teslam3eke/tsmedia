/**
 * 本機 Vercel API 替身：供 `npm run dev` 時 Vite proxy `/api/*` 轉發。
 * 載入 .env.local 後執行 api/*.ts handler（生活照 AI、刪除帳號等）。
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { loadEnv } from 'vite'
import type { VercelRequest, VercelResponse } from '@vercel/node'
import verifyLifePhoto from '../api/verify-life-photo'
import deleteAccount from '../api/delete-account'

const env = loadEnv('development', process.cwd(), '')
for (const [key, value] of Object.entries(env)) {
  if (process.env[key] === undefined) process.env[key] = value
}

const PORT = Number(process.env.DEV_API_PORT ?? 3001)

type ApiHandler = (req: VercelRequest, res: VercelResponse) => void | Promise<void>

const ROUTES: Record<string, ApiHandler> = {
  '/api/verify-life-photo': verifyLifePhoto,
  '/api/delete-account': deleteAccount,
}

function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8')
      if (!raw.trim()) {
        resolve(undefined)
        return
      }
      try {
        resolve(JSON.parse(raw))
      } catch {
        resolve(undefined)
      }
    })
    req.on('error', reject)
  })
}

function toVercelResponse(nodeRes: ServerResponse): VercelResponse {
  const res = nodeRes as unknown as VercelResponse & ServerResponse
  res.status = (code: number) => {
    nodeRes.statusCode = code
    return res
  }
  res.json = (body: unknown) => {
    if (!nodeRes.headersSent) {
      nodeRes.setHeader('Content-Type', 'application/json; charset=utf-8')
    }
    nodeRes.end(JSON.stringify(body))
    return res
  }
  return res
}

async function toVercelRequest(
  nodeReq: IncomingMessage,
  body: unknown,
): Promise<VercelRequest> {
  const url = new URL(nodeReq.url ?? '/', `http://127.0.0.1:${PORT}`)
  const query: Record<string, string | string[]> = {}
  for (const [key, value] of url.searchParams.entries()) {
    const prev = query[key]
    if (prev === undefined) query[key] = value
    else if (Array.isArray(prev)) prev.push(value)
    else query[key] = [prev, value]
  }
  return {
    method: nodeReq.method ?? 'GET',
    url: nodeReq.url,
    headers: nodeReq.headers as VercelRequest['headers'],
    body,
    query,
  } as VercelRequest
}

function applyCors(res: ServerResponse): void {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
}

createServer((nodeReq, nodeRes) => {
  void (async () => {
    try {
      const pathname = new URL(nodeReq.url ?? '/', `http://127.0.0.1:${PORT}`).pathname
      const handler = ROUTES[pathname]

      applyCors(nodeRes)

      if (nodeReq.method === 'OPTIONS' && handler) {
        nodeRes.statusCode = 204
        nodeRes.end()
        return
      }

      if (!handler) {
        nodeRes.statusCode = 404
        nodeRes.setHeader('Content-Type', 'application/json; charset=utf-8')
        nodeRes.end(JSON.stringify({ ok: false, message: `本機 API 未掛載：${pathname}` }))
        return
      }

      const body = nodeReq.method === 'POST' ? await readJsonBody(nodeReq) : undefined
      const req = await toVercelRequest(nodeReq, body)
      const res = toVercelResponse(nodeRes)
      await handler(req, res)
      if (!nodeRes.writableEnded) {
        nodeRes.statusCode = 500
        nodeRes.end(JSON.stringify({ ok: false, message: 'API handler 未回傳' }))
      }
    } catch (err) {
      console.error('[dev-api-server]', err)
      if (!nodeRes.writableEnded) {
        nodeRes.statusCode = 500
        nodeRes.setHeader('Content-Type', 'application/json; charset=utf-8')
        nodeRes.end(JSON.stringify({ ok: false, message: '本機 API 錯誤' }))
      }
    }
  })()
}).listen(PORT, '127.0.0.1', () => {
  console.info(`[dev-api-server] http://127.0.0.1:${PORT} （${Object.keys(ROUTES).join(', ')}）`)
})
