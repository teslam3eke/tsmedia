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
/** 換日廣播專用：Web Push RFC 對 `urgency` 的語意有助於部分推播網（含 APNs）較不慢排／晚送。聊天推播維持預設即可。 */
const PUSH_OPTIONS_BROADCAST = { TTL: 86_400, urgency: 'high' as const }

/** 與前端心跳間隔對齊：超過此時間視為不在聊天室 */
const PRESENCE_TTL_MS = 45_000

/** 與探索「每晚 10 點」同一曆日（Asia/Taipei）；tag 加分日避免被推播 SDK 過度去重 */
function discoverRolloverTagSuffix(): string {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

function normalizeMatchIdCompact(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null
  const t = raw.trim().toLowerCase().replace(/-/g, '')
  return t.length > 0 ? t : null
}

type PushSubscriptionRow = {
  endpoint: string
  p256dh: string
  auth: string
  client_key: string | null
}

type PresenceRow = {
  client_key: string
  active_match_id: string | null
  visibility: string
  updated_at: string
}

async function loadFreshPresenceByClientKey(
  supabase: ReturnType<typeof adminSupabase>,
  userId: string,
  clientKeys: readonly string[],
): Promise<Map<string, PresenceRow>> {
  const map = new Map<string, PresenceRow>()
  const keys = [...new Set(clientKeys.filter(Boolean))]
  if (keys.length === 0) return map

  const sinceIso = new Date(Date.now() - PRESENCE_TTL_MS).toISOString()
  const { data, error } = await supabase
    .from('user_chat_presence')
    .select('client_key, active_match_id, visibility, updated_at')
    .eq('user_id', userId)
    .in('client_key', keys)
    .gte('updated_at', sinceIso)

  if (error) throw error
  for (const row of data ?? []) {
    if (row?.client_key) map.set(row.client_key, row as PresenceRow)
  }
  return map
}

function shouldSkipMessagePushForPresence(
  presence: PresenceRow | undefined,
  refMatchId: string,
): boolean {
  if (!presence) return false
  if (presence.visibility !== 'visible') return false
  if (!presence.active_match_id) return false
  const activeLc = normalizeMatchIdCompact(presence.active_match_id)
  const refLc = normalizeMatchIdCompact(refMatchId)
  if (!activeLc || !refLc) return false
  return activeLc === refLc
}

async function parallelMapChunks<T>(
  items: readonly T[],
  chunkSize: number,
  mapper: (item: T) => Promise<void>,
): Promise<void> {
  for (let i = 0; i < items.length; i += chunkSize) {
    const chunk = items.slice(i, i + chunkSize)
    await Promise.all(chunk.map((item) => mapper(item)))
  }
}

async function sendToSubscription(
  supabase: ReturnType<typeof adminSupabase>,
  row: Pick<PushSubscriptionRow, 'endpoint' | 'p256dh' | 'auth'>,
  payloadText: string,
  options: typeof PUSH_PAYLOAD_OPTIONS | typeof PUSH_OPTIONS_BROADCAST = PUSH_PAYLOAD_OPTIONS,
): Promise<'ok' | 'fail' | 'gone'> {
  const sub = {
    endpoint: row.endpoint,
    keys: { p256dh: row.p256dh, auth: row.auth },
  }
  try {
    await webpush.sendNotification(sub, payloadText, options)
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
  options: typeof PUSH_PAYLOAD_OPTIONS | typeof PUSH_OPTIONS_BROADCAST = PUSH_PAYLOAD_OPTIONS,
): Promise<{ sent: number; failed: number; skipped: number }> {
  configureWebPush()
  const supabase = adminSupabase()
  const { data: rows, error } = await supabase
    .from('push_subscriptions')
    .select('endpoint, p256dh, auth, client_key')
    .eq('user_id', userId)

  if (error) throw error
  if (!rows?.length) return { sent: 0, failed: 0, skipped: 0 }

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
  const skipped = 0
  for (const r of rows as PushSubscriptionRow[]) {
    const out = await sendToSubscription(supabase, r, payloadText, options)
    if (out === 'ok') sent++
    else failed++
  }
  return { sent, failed, skipped }
}

/** 聊天／訊息類：較高 urgency；依 server presence 對「正在看該房」的裝置略過推播 */
export async function sendWebPushMessageToUser(
  userId: string,
  payload: { title: string; body: string; tag: string; url?: string; matchId?: string | null },
): Promise<{ sent: number; failed: number; skipped: number }> {
  configureWebPush()
  const supabase = adminSupabase()
  const refMatchId = typeof payload.matchId === 'string' ? payload.matchId.trim() : ''

  const { data: rows, error } = await supabase
    .from('push_subscriptions')
    .select('endpoint, p256dh, auth, client_key')
    .eq('user_id', userId)

  if (error) throw error
  if (!rows?.length) return { sent: 0, failed: 0, skipped: 0 }

  const subs = rows as PushSubscriptionRow[]
  const presenceByKey =
    refMatchId.length > 0
      ? await loadFreshPresenceByClientKey(
          supabase,
          userId,
          subs.map((s) => s.client_key ?? ''),
        )
      : new Map<string, PresenceRow>()

  const payloadText = JSON.stringify({
    title: payload.title,
    body: payload.body,
    tag: payload.tag,
    url: payload.url ?? '/',
    ...(refMatchId ? { matchId: refMatchId } : {}),
  })

  let sent = 0
  let failed = 0
  let skipped = 0
  for (const r of subs) {
    if (
      refMatchId &&
      r.client_key &&
      shouldSkipMessagePushForPresence(presenceByKey.get(r.client_key), refMatchId)
    ) {
      skipped++
      continue
    }
    const out = await sendToSubscription(supabase, r, payloadText, {
      TTL: 86_400,
      urgency: 'high',
    })
    if (out === 'ok') sent++
    else failed++
  }
  return { sent, failed, skipped }
}

/** 每晚換日廣播：依 endpoint 逐筆送出（同一使用者多裝置各自一則）。 */
export async function broadcastDiscoverDeckRolloverPush(): Promise<{
  sent: number
  failed: number
  gone: number
  scanned: number
}> {
  configureWebPush()
  const supabase = adminSupabase()

  const title = '探索名單已更新'
  const body = '每日晚上 10 點換日，今日配對推薦已重新產生。'
  const dayTag = `tsm-discover-deck-day-${discoverRolloverTagSuffix()}`
  const payloadText = JSON.stringify({
    title,
    body,
    tag: dayTag,
    url: '/',
  })

  /** 並行發送以降低 Vercel serverless 逾時造成「後段訂閱全沒發到」 */
  const pageSize = 500
  /** 同一批內併發數（FCM/APNs 可承受適度平行；過高易觸發速率限制） */
  const concurrency = 32
  let offset = 0
  let sent = 0
  let failed = 0
  let gone = 0
  let scanned = 0

  for (;;) {
    const { data: rows, error } = await supabase
      .from('push_subscriptions')
      .select('endpoint, p256dh, auth')
      .order('id', { ascending: true })
      .range(offset, offset + pageSize - 1)

    if (error) throw error
    if (!rows?.length) break

    await parallelMapChunks(rows, concurrency, async (r) => {
      scanned++
      const out = await sendToSubscription(supabase, r, payloadText, PUSH_OPTIONS_BROADCAST)
      if (out === 'ok') sent++
      else if (out === 'gone') gone++
      else failed++
    })
    offset += rows.length
    if (rows.length < pageSize) break
  }

  return { sent, failed, gone, scanned }
}
