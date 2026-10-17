/**
 * POST：後端 authoritative 送審 + SubmitApplication CAPI（event_id = application id）
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
import { patchProfileMetaAttributionIfPresent } from './_utils/metaCapiAttributionPatch.js'
import { deliverMetaSubmitApplicationCapiIfNeeded } from './_utils/metaCapiSubmitApplication.js'
import {
  runVerificationSubmitApplication,
  type VerificationSubmitDocInput,
} from './_utils/verificationSubmitApplication.js'

function parseDocs(body: unknown): VerificationSubmitDocInput[] {
  if (!body || typeof body !== 'object') return []
  const raw = (body as Record<string, unknown>).docs
  if (!Array.isArray(raw)) return []
  const out: VerificationSubmitDocInput[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const o = item as Record<string, unknown>
    const kind = o.kind
    const docType = o.docType ?? o.doc_type
    const path = o.path ?? o.doc_url
    if (kind !== 'identity' && kind !== 'bonus' && kind !== 'income') continue
    if (typeof docType !== 'string' || typeof path !== 'string') continue
    const pathTrim = path.trim()
    if (!pathTrim) continue
    out.push({
      kind,
      docType: docType.trim(),
      path: pathTrim,
      claimedIncomeTier:
        typeof o.claimedIncomeTier === 'string'
          ? o.claimedIncomeTier
          : typeof o.claimed_income_tier === 'string'
            ? o.claimed_income_tier
            : null,
    })
  }
  return out
}

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
  const o = body && typeof body === 'object' ? (body as Record<string, unknown>) : {}
  const declaredCompany =
    typeof o.declaredCompany === 'string'
      ? o.declaredCompany
      : typeof o.declared_company === 'string'
        ? o.declared_company
        : ''
  const docs = parseDocs(body)
  const attribution = readMetaAttributionFromBody(body)

  const admin = createClient(url, service)
  await patchProfileMetaAttributionIfPresent(admin, auth.userId, attribution)

  const result = await runVerificationSubmitApplication(admin, auth.userId, declaredCompany, docs)
  if (!result.ok) {
    return res.status(400).json({ ok: false, error: result.error })
  }

  const capiCtx = {
    clientIpAddress: readClientIpFromRequest(req),
    clientUserAgent: readClientUserAgent(req),
    eventSourceUrl: readEventSourceUrlFromBody(body),
  }
  await deliverMetaSubmitApplicationCapiIfNeeded(admin, result.applicationId, capiCtx)

  return res.status(200).json({ ok: true, applicationId: result.applicationId })
}
