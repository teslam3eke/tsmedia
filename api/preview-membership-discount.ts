/**
 * POST：會員折扣碼 preview（TSSPE server authoritative；TSVIP/TSFB 委派 RPC）。
 * Body: { code: string }
 */
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { readAuthedUserId, readTapPayEnv } from './_utils/tappayPayByPrime.js'
import { previewMembershipDiscountAuthoritative } from './_utils/previewMembershipDiscountServer.js'

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  res.setHeader('Cache-Control', 'no-store')

  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'Method not allowed' })
    return
  }

  const env = readTapPayEnv()
  if (!env.ok) {
    res.status(500).json({ ok: false, error: env.error })
    return
  }

  const auth = await readAuthedUserId(req, env.url, env.anon)
  if (!auth.ok) {
    res.status(auth.status).json({ ok: false, error: auth.error })
    return
  }

  const body = (typeof req.body === 'object' && req.body ? req.body : {}) as { code?: unknown }
  const codeRaw = typeof body.code === 'string' ? body.code : ''
  if (!codeRaw.trim()) {
    res.status(400).json({ ok: false, reason: 'invalid_code' })
    return
  }

  const authHeader = req.headers.authorization?.trim()
  const bearer =
    authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null
  if (!bearer) {
    res.status(401).json({ ok: false, error: '請重新登入後再試。' })
    return
  }

  const userRpcClient = createClient(env.url, env.anon, {
    global: { headers: { Authorization: `Bearer ${bearer}` } },
  })
  const admin = createClient(env.url, env.serviceKey)

  const { data: profile, error: profileErr } = await admin
    .from('profiles')
    .select('gender, verification_status, account_status')
    .eq('id', auth.userId)
    .maybeSingle()

  if (profileErr || !profile) {
    res.status(400).json({ ok: false, reason: 'membership_not_eligible' })
    return
  }

  const preview = await previewMembershipDiscountAuthoritative(admin, userRpcClient, {
    userId: auth.userId,
    codeRaw,
    profile: {
      gender: profile.gender,
      verification_status: profile.verification_status,
      account_status: profile.account_status,
    },
  })

  res.status(200).json(preview)
}
