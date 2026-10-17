/**
 * 可選 Cron：重試尚未送達的 Approval Email（需 CRON_SECRET）。
 * vercel.json 未預設排程；可手動 POST 或自行加 cron。
 */
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { retryPendingApprovalEmails } from './_utils/deliverApprovalEmailIfNeeded.js'

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
  const processed = await retryPendingApprovalEmails(admin, 20)
  res.status(200).json({ ok: true, processed })
}
