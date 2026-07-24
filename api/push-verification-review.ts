/**
 * 管理後台審核後的直接 Web Push 備援。
 * Database Webhook 仍保留；此端點確保手動通過／退件不會因 Webhook 延遲或漏送而沒有 OS 推播。
 */
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { sendWebPushToUser } from './_utils/pushSend.js'

const PUSH_OPTIONS_HIGH = { TTL: 86_400, urgency: 'high' as const }

function bearerToken(req: VercelRequest): string | null {
  const auth = req.headers.authorization?.trim()
  if (!auth?.startsWith('Bearer ')) return null
  return auth.slice('Bearer '.length).trim() || null
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).end()
    return
  }

  const token = bearerToken(req)
  const url = process.env.SUPABASE_URL?.trim()
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  if (!token || !url || !serviceKey) {
    res.status(401).json({ error: 'unauthorized' })
    return
  }

  try {
    const admin = createClient(url, serviceKey)
    const { data: userData, error: userError } = await admin.auth.getUser(token)
    const callerId = userData.user?.id
    if (userError || !callerId) {
      res.status(401).json({ error: 'invalid session' })
      return
    }

    const { data: callerProfile, error: profileError } = await admin
      .from('profiles')
      .select('is_admin')
      .eq('id', callerId)
      .maybeSingle()
    if (profileError || callerProfile?.is_admin !== true) {
      res.status(403).json({ error: 'admin only' })
      return
    }

    const rawBody = typeof req.body === 'string' ? JSON.parse(req.body) : req.body ?? {}
    const userId = typeof rawBody.userId === 'string' ? rawBody.userId.trim() : ''
    const kind = typeof rawBody.kind === 'string' ? rawBody.kind.trim() : ''
    const title = typeof rawBody.title === 'string' ? rawBody.title.trim() : ''
    const body = typeof rawBody.body === 'string' ? rawBody.body.trim() : ''
    if (!userId || !title || !body) {
      res.status(400).json({ error: 'userId, title and body required' })
      return
    }
    if (
      kind !== 'verification_approved' &&
      kind !== 'verification_rejected'
    ) {
      res.status(400).json({ error: 'not a verification review notification' })
      return
    }

    /** 由 service role 建立通知並取回 ID，避開管理員不能 SELECT 對方通知的 RLS 限制。 */
    const { data: notification, error: notificationError } = await admin
      .from('app_notifications')
      .insert({
        user_id: userId,
        kind,
        title,
        body,
      })
      .select('id,user_id,kind,title,body')
      .single()
    if (notificationError || !notification) {
      res.status(500).json({ error: notificationError?.message ?? 'notification insert failed' })
      return
    }

    const result = await sendWebPushToUser(
      notification.user_id,
      {
        title: notification.title,
        body: notification.body ?? '',
        tag: `app-notif-${notification.kind}-${notification.id}`,
        url: `/?tab=profile&notif=${encodeURIComponent(notification.id)}&fromPush=1&pushTs=${Date.now()}`,
        kind: notification.kind,
        notifId: notification.id,
      },
      PUSH_OPTIONS_HIGH,
    )

    console.info('[push-verification-review] delivered', {
      notificationId: notification.id,
      sent: result.sent,
      failed: result.failed,
      skipped: result.skipped,
    })
    res.status(200).json({
      ok: result.sent > 0,
      notificationId: notification.id,
      ...result,
    })
  } catch (error) {
    console.error('[push-verification-review]', error)
    res.status(500).json({ error: 'send failed' })
  }
}
