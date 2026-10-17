/**
 * Vercel Cron：每 6 小時執行 acquisition coupon lifecycle（48h / 7d issue + Email）。
 * 僅處理有 acquisition_lifecycle_anchor_at 的新男性會員；需 CRON_SECRET + service_role。
 */
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { runAcquisitionCouponLifecycleCron } from './_utils/acquisitionCouponLifecycleCron.js'

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.status(405).end()
    return
  }

  const cronSecret = process.env.CRON_SECRET?.trim()
  if (cronSecret) {
    const auth = req.headers.authorization?.trim()
    if (auth !== `Bearer ${cronSecret}`) {
      res.status(401).json({ ok: false, error: 'unauthorized' })
      return
    }
  }

  const url = process.env.SUPABASE_URL?.trim() ?? process.env.VITE_SUPABASE_URL?.trim()
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  if (!url || !serviceKey) {
    res.status(500).json({ ok: false, error: 'server config' })
    return
  }

  const admin = createClient(url, serviceKey)
  const stats = await runAcquisitionCouponLifecycleCron(admin)
  console.info('[cron-acquisition-coupon-lifecycle]', stats)
  res.status(200).json({ ok: true, ...stats })
}
