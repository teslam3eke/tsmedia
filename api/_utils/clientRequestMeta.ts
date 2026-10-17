import type { VercelRequest } from '@vercel/node'
import { sanitizeMetaEventSourceUrl, sanitizeMetaFbc, sanitizeMetaFbp } from './metaCapi.js'

export function readClientIpFromRequest(req: VercelRequest): string | null {
  const forwarded = req.headers['x-forwarded-for']
  const raw = typeof forwarded === 'string' ? forwarded.split(',')[0]?.trim() : ''
  if (raw && raw.length <= 45) return raw
  const realIp = req.headers['x-real-ip']
  if (typeof realIp === 'string' && realIp.trim().length <= 45) return realIp.trim()
  return null
}

export function readClientUserAgent(req: VercelRequest): string | null {
  const ua = req.headers['user-agent']
  if (typeof ua !== 'string') return null
  const t = ua.trim()
  return t.length > 512 ? t.slice(0, 512) : t
}

export type MetaAttributionInput = {
  metaFbp: string | null
  metaFbc: string | null
}

export function readMetaAttributionFromBody(body: unknown): MetaAttributionInput {
  const o = body && typeof body === 'object' ? (body as Record<string, unknown>) : {}
  return {
    metaFbp: sanitizeMetaFbp(o.metaFbp ?? o.meta_fbp),
    metaFbc: sanitizeMetaFbc(o.metaFbc ?? o.meta_fbc),
  }
}

export function readEventSourceUrlFromBody(body: unknown): string {
  const o = body && typeof body === 'object' ? (body as Record<string, unknown>) : {}
  const raw = o.eventSourceUrl ?? o.event_source_url
  return sanitizeMetaEventSourceUrl(typeof raw === 'string' ? raw : null)
}
