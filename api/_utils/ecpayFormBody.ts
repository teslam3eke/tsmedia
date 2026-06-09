import type { VercelRequest } from '@vercel/node'

function paramsFromSearchString(raw: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of new URLSearchParams(raw)) {
    out[k] = v
  }
  return out
}

function readRawRequestBody(req: VercelRequest): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

/** 解析綠界 POST（application/x-www-form-urlencoded）；優先讀 raw body 避免 Vercel 預解析改值 */
export async function readEcpayFormBody(req: VercelRequest): Promise<Record<string, string>> {
  if (typeof req.body === 'string' && req.body.length > 0) {
    return paramsFromSearchString(req.body)
  }

  const raw = await readRawRequestBody(req)
  if (raw.trim()) {
    return paramsFromSearchString(raw)
  }

  if (req.body && typeof req.body === 'object') {
    const out: Record<string, string> = {}
    for (const [k, v] of Object.entries(req.body as Record<string, unknown>)) {
      if (v === undefined || v === null) continue
      if (Array.isArray(v)) {
        if (v[0] !== undefined && v[0] !== null) out[k] = String(v[0])
        continue
      }
      out[k] = String(v)
    }
    return out
  }

  return {}
}
