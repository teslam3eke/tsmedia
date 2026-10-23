import type { SupabaseClient } from '@supabase/supabase-js'

/** OS 推播由 Supabase `app_notifications` INSERT webhook 統一送出，避免與此處重複跳兩次。 */
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

  return {
    created: true,
    sent: 0,
    failed: 0,
  }
}
