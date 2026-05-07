/**
 * Database Webhook：Supabase `app_notifications` INSERT → 對該 user 所有裝置發 Web Push。
 *
 * Dashboard：Database > Webhooks > Create
 * - Table: public.app_notifications, Events: INSERT
 * - HTTP Request URL: https://你的網域/api/push-webhook-app-notification
 * - HTTP Headers: Authorization: Bearer <PUSH_WEBHOOK_SECRET>（與 Vercel PUSH_WEBHOOK_SECRET 相同）
 *
 * 環境變數（Vercel）：
 * - VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY（npx web-push generate-vapid-keys）
 * - VAPID_WEB_PUSH_CONTACT（mailto:…）
 * - SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY
 * - PUSH_WEBHOOK_SECRET（隨機字串）
 */
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { sendWebPushToUser } from './_utils/pushSend'

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).end()
    return
  }

  const secret = process.env.PUSH_WEBHOOK_SECRET?.trim()
  const auth = req.headers.authorization?.trim()
  const hdr = typeof req.headers['x-tsmedia-push-secret'] === 'string' ? req.headers['x-tsmedia-push-secret'].trim() : ''
  const ok = Boolean(secret && (auth === `Bearer ${secret}` || hdr === secret))
  if (!ok) {
    res.status(401).json({ error: 'unauthorized' })
    return
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body
    const type = body?.type as string | undefined
    const table = body?.table as string | undefined
    const record = (body?.record ??
      body?.payload?.record ??
      body?.new) as { user_id?: string; title?: string; body?: string; kind?: string } | undefined

    if (type !== 'INSERT' || table !== 'app_notifications' || !record?.user_id || !record.title) {
      res.status(400).json({ error: 'expected INSERT on app_notifications with user_id and title' })
      return
    }

    const tag = `app-notif-${record.kind ?? 'generic'}`
    const result = await sendWebPushToUser(record.user_id, {
      title: record.title,
      body: record.body ?? '',
      tag,
      url: '/',
    })
    res.status(200).json({ ok: true, ...result })
  } catch (e) {
    console.error('[push-webhook-app-notification]', e)
    res.status(500).json({ error: 'send failed' })
  }
}
