/**
 * GET：authenticated read-only — 目前可自動套用的 acquisition lifecycle entitlement + server 價格預覽。
 */
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { readAuthedUserId } from './_utils/tappayPayByPrime.js'
import { buildMyAcquisitionCouponCheckoutPreview } from './_utils/myAcquisitionCouponCheckout.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  res.setHeader('Cache-Control', 'no-store')

  if (req.method === 'OPTIONS') {
    return res.status(204).end()
  }

  if (req.method !== 'GET') {
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

  const admin = createClient(url, service)
  const preview = await buildMyAcquisitionCouponCheckoutPreview(admin, auth.userId)

  if (!preview) {
    return res.status(200).json({ ok: true, autoApply: null })
  }

  return res.status(200).json({
    ok: true,
    autoApply: {
      entitlementId: preview.entitlementId,
      campaignKey: preview.campaignKey,
      finalAmountNtd: preview.finalAmountNtd,
      listPriceNtd: preview.listPriceNtd,
      promoPriceNtd: preview.promoPriceNtd,
      displayLabel: preview.displayLabel,
      expiresAt: preview.expiresAt,
    },
  })
}
