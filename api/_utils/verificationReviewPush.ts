import type { SupabaseClient } from '@supabase/supabase-js'
import { sendWebPushToUser } from './pushSend.js'

const PUSH_OPTIONS_HIGH = { TTL: 86_400, urgency: 'high' as const }

export async function sendVerificationReviewPush(
  admin: SupabaseClient,
  payload: {
    userId: string
    kind: 'verification_approved' | 'verification_rejected'
    title: string
    body: string
  },
): Promise<{ created: boolean; sent: number; failed: number; error?: string }> {
  const userId = payload.userId.trim()
  if (!userId) return { created: false, sent: 0, failed: 0, error: 'missing user' }

  const { data: notification, error: notificationError } = await admin
    .from('app_notifications')
    .insert({
      user_id: userId,
      kind: payload.kind,
      title: payload.title,
      body: payload.body,
    })
    .select('id,user_id,kind,title,body')
    .single()

  if (notificationError || !notification) {
    return {
      created: false,
      sent: 0,
      failed: 0,
      error: notificationError?.message ?? 'notification insert failed',
    }
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

  return {
    created: true,
    sent: result.sent,
    failed: result.failed,
    error: result.sent > 0 ? undefined : 'push not delivered',
  }
}
