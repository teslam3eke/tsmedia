/**
 * Vercel Cron：Registration Reminder（+24h/+48h/+72h；UTC 01:30/07:30/13:30/19:30；
 * 本 lifecycle 日 cap 30、月 cap 600；與 acquisition cron 錯開 30 分）。
 */
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { runRegistrationReminderEmailCron } from './_utils/registrationReminderCron.js'

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.status(405).end()
    return
  }

  const cronSecret = process.env.CRON_SECRET?.trim()
  if (!cronSecret) {
    res.status(500).json({ ok: false, error: 'server config: cron secret missing' })
    return
  }

  const auth = req.headers.authorization?.trim()
  if (auth !== `Bearer ${cronSecret}`) {
    res.status(401).json({ ok: false, error: 'unauthorized' })
    return
  }

  const url = process.env.SUPABASE_URL?.trim() ?? process.env.VITE_SUPABASE_URL?.trim()
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  if (!url || !serviceKey) {
    res.status(500).json({ ok: false, error: 'server config' })
    return
  }

  const admin = createClient(url, serviceKey)
  const stats = await runRegistrationReminderEmailCron(admin)
  console.info('[cron-registration-reminder-email]', stats)
  res.status(200).json({ ok: true, ...stats })
}
