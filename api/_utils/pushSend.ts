import webpush from 'web-push'
import { createClient } from '@supabase/supabase-js'

let vapidConfigured = false

function configureWebPush(): void {
  if (vapidConfigured) return
  const pub = process.env.VAPID_PUBLIC_KEY?.trim()
  const priv = process.env.VAPID_PRIVATE_KEY?.trim()
  const mail = process.env.VAPID_WEB_PUSH_CONTACT?.trim() || 'mailto:contact@example.com'
  if (!pub || !priv) {
    throw new Error('Missing VAPID_PUBLIC_KEY or VAPID_PRIVATE_KEY')
  }
  webpush.setVapidDetails(mail, pub, priv)
  vapidConfigured = true
}

function adminSupabase() {
  const url = process.env.SUPABASE_URL?.trim()
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  if (!url || !key) throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  return createClient(url, key)
}

const PUSH_PAYLOAD_OPTIONS = { TTL: 86_400 } as const

async function sendToSubscription(
  supabase: ReturnType<typeof adminSupabase>,
  row: { endpoint: string; p256dh: string; auth: string },
  payloadText: string,
): Promise<'ok' | 'fail' | 'gone'> {
  const sub = {
    endpoint: row.endpoint,
    keys: { p256dh: row.p256dh, auth: row.auth },
  }
  try {
    await webpush.sendNotification(sub, payloadText, PUSH_PAYLOAD_OPTIONS)
    return 'ok'
  } catch (e: unknown) {
    const status =
      typeof e === 'object' && e && 'statusCode' in e ? (e as { statusCode?: number }).statusCode : 0
    if (status === 404 || status === 410) {
      await supabase.from('push_subscriptions').delete().eq('endpoint', row.endpoint)
      return 'gone'
    }
    return 'fail'
  }
}

export async function sendWebPushToUser(
  userId: string,
  payload: { title: string; body: string; tag: string; url?: string; matchId?: string | null },
): Promise<{ sent: number; failed: number }> {
  configureWebPush()
  const supabase = adminSupabase()
  const { data: rows, error } = await supabase
    .from('push_subscriptions')
    .select('endpoint, p256dh, auth')
    .eq('user_id', userId)

  if (error) throw error
  if (!rows?.length) return { sent: 0, failed: 0 }

  const payloadText = JSON.stringify({
    title: payload.title,
    body: payload.body,
    tag: payload.tag,
    url: payload.url ?? '/',
    ...(typeof payload.matchId === 'string' && payload.matchId.trim()
      ? { matchId: payload.matchId.trim() }
      : {}),
  })

  let sent = 0
  let failed = 0
  for (const r of rows) {
    const out = await sendToSubscription(supabase, r, payloadText)
    if (out === 'ok') sent++
    else failed++
  }
  return { sent, failed }
}

/** 每晚換日廣播：依 endpoint 逐筆送出（同一使用者多裝置各自一則）。 */
export async function broadcastDiscoverDeckRolloverPush(): Promise<{ sent: number; failed: number }> {
  configureWebPush()
  const supabase = adminSupabase()

  const title = '探索名單已更新'
  const body = '每日晚上 10 點換日，今日配對推薦已重新產生。'
  const payloadText = JSON.stringify({
    title,
    body,
    tag: 'tsm-discover-deck-day',
    url: '/',
  })

  const pageSize = 400
  let offset = 0
  let sent = 0
  let failed = 0

  for (;;) {
    const { data: rows, error } = await supabase
      .from('push_subscriptions')
      .select('endpoint, p256dh, auth')
      .order('id', { ascending: true })
      .range(offset, offset + pageSize - 1)

    if (error) throw error
    if (!rows?.length) break

    for (const r of rows) {
      const out = await sendToSubscription(supabase, r, payloadText)
      if (out === 'ok') sent++
      else failed++
    }
    offset += rows.length
    if (rows.length < pageSize) break
  }

  return { sent, failed }
}
