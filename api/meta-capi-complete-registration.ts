/**
 * POST：已驗證 JWT 使用者送 CompleteRegistration CAPI（event_id = user.id）
 */
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { readAuthedUserId } from './_utils/tappayPayByPrime.js'
import {
  readClientIpFromRequest,
  readClientUserAgent,
  readEventSourceUrlFromBody,
  readMetaAttributionFromBody,
} from './_utils/clientRequestMeta.js'
import {
  freezeRegistrationMetaAttributionIfPresent,
  patchProfileMetaAttributionIfPresent,
} from './_utils/metaCapiAttributionPatch.js'
import { deliverMetaCompleteRegistrationCapiIfNeeded } from './_utils/metaCapiCompleteRegistration.js'

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
  const attribution = readMetaAttributionFromBody(body)
  const eventSourceUrl = readEventSourceUrlFromBody(body)
  const admin = createClient(url, service)

  await freezeRegistrationMetaAttributionIfPresent(admin, auth.userId, attribution)

  await deliverMetaCompleteRegistrationCapiIfNeeded(admin, auth.userId, {
    clientIpAddress: readClientIpFromRequest(req),
    clientUserAgent: readClientUserAgent(req),
    eventSourceUrl,
    attribution,
  })

  await patchProfileMetaAttributionIfPresent(admin, auth.userId, attribution)

  return res.status(200).json({ ok: true })
}
