/**
 * POST：同步 Meta _fbp / _fbc 至 profiles（跨 session attribution）
 */
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { readAuthedUserId } from './_utils/tappayPayByPrime.js'
import { readMetaAttributionFromBody } from './_utils/clientRequestMeta.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  res.setHeader('Cache-Control', 'no-store')

  if (req.method === 'OPTIONS') {
    return res.status(204).end()
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' })
  }

  const url = process.env.SUPABASE_URL?.trim() ?? process.env.VITE_SUPABASE_URL?.trim()
  const anon = process.env.SUPABASE_ANON_KEY?.trim() ?? process.env.VITE_SUPABASE_ANON_KEY?.trim()
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  if (!url || !anon || !service) {
    return res.status(500).json({ ok: false, error: 'Server config error' })
  }

  const auth = await readAuthedUserId(req, url, anon)
  if (!auth.ok) {
    return res.status(auth.status).json({ ok: false, error: auth.error })
  }

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body
  const { metaFbp, metaFbc } = readMetaAttributionFromBody(body)
  if (!metaFbp && !metaFbc) {
    return res.status(200).json({ ok: true, updated: false })
  }

  const patch: Record<string, string> = { meta_attribution_updated_at: new Date().toISOISOString() }
  if (metaFbp) patch.meta_fbp = metaFbp
  if (metaFbc) patch.meta_fbc = metaFbc

  const admin = createClient(url, service)
  const { error } = await admin.from('profiles').update(patch).eq('id', auth.userId)
  if (error) {
    console.warn('[meta-attribution] update failed', { userId: auth.userId, message: error.message })
    return res.status(500).json({ ok: false, error: 'update failed' })
  }

  return res.status(200).json({ ok: true, updated: true })
}
