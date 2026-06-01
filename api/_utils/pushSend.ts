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

/** 與探索「每晚 10 點」同一曆日（Asia/Taipei）；tag 加分日避免被推播 SDK 過度去重 */
function discoverRolloverTagSuffix(): string {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

type PushSubscriptionRow = {
  endpoint: string
  p256dh: string
  auth: string
  client_key: string | null
}

export type WebPushPayload = {
  title: string
  body: string
  tag: string
  url?: string
  matchId?: string | null
  kind?: string
  notifId?: string
  refMatchId?: string | null
  /** 配對聊天未讀加總；SW 背景推播直接設絕對值，避免累加漂移 */
  badgeCount?: number
}

function buildPushPayloadText(payload: WebPushPayload): string {
  const matchId =
    typeof payload.matchId === 'string' && payload.matchId.trim() ? payload.matchId.trim() : ''
  const refMatchId =
    typeof payload.refMatchId === 'string' && payload.refMatchId.trim()
      ? payload.refMatchId.trim()
      : matchId
  return JSON.stringify({
    title: payload.title,
    body: payload.body,
    tag: payload.tag,
    url: payload.url ?? '/',
    ...(matchId ? { matchId } : {}),
    ...(refMatchId ? { refMatchId } : {}),
    ...(payload.kind ? { kind: payload.kind } : {}),
    ...(payload.notifId ? { notifId: payload.notifId } : {}),
    ...(typeof payload.badgeCount === 'number' && Number.isFinite(payload.badgeCount)
      ? { badgeCount: Math.max(0, Math.min(99, Math.floor(payload.badgeCount))) }
      : {}),
  })
}

/** 使用者所有配對聊天未讀則數加總（service role；供推播角標絕對值） */
async function fetchUserMatchUnreadTotal(
  supabase: ReturnType<typeof adminSupabase>,
  userId: string,
): Promise<number> {
  const { data: matchRows, error: matchErr } = await supabase
    .from('matches')
    .select('id')
    .or(`user_a.eq.${userId},user_b.eq.${userId}`)
  if (matchErr) {
    console.warn('[pushSend] unread matches', matchErr.message)
    return 0
  }
  const matchIds = (matchRows ?? []).map((r) => r.id).filter(Boolean)
  if (matchIds.length === 0) return 0

  const { count, error: msgErr } = await supabase
    .from('messages')
    .select('id', { count: 'exact', head: true })
    .in('match_id', matchIds)
    .is('read_at', null)
    .neq('sender_id', userId)
  if (msgErr) {
    console.warn('[pushSend] unread messages', msgErr.message)
    return 0
  }
  return Math.max(0, Math.min(99, count ?? 0))
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

export type SendWebPushFilter = {
  /** 僅送此 PWA 安裝（與 push_subscriptions.client_key 對齊） */
  clientKey?: string
}

function compactMatchId(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null
  const t = raw.trim().toLowerCase().replace(/-/g, '')
  return t.length > 0 ? t : null
}

/** 與前端 chat presence 心跳（15s）對齊；逾時視為 stale 仍發推播 */
const CHAT_PRESENCE_TTL_MS = 90_000

/** 067：前景開啟某 match 聊天室 → 該 client_key 的 push 訂閱略過 message_received */
async function resolveChatPresenceSkipClientKeys(
  supabase: ReturnType<typeof adminSupabase>,
  userId: string,
  matchId: string | null | undefined,
): Promise<Set<string>> {
  const target = compactMatchId(matchId)
  if (!target) return new Set()

  const { data, error } = await supabase
    .from('user_chat_presence')
    .select('client_key, active_match_id, visibility, updated_at')
    .eq('user_id', userId)
    .eq('visibility', 'visible')

  if (error) {
    console.warn('[pushSend] user_chat_presence query', error.message)
    return new Set()
  }

  const now = Date.now()
  const skip = new Set<string>()
  for (const row of data ?? []) {
    const key = typeof row.client_key === 'string' ? row.client_key.trim() : ''
    if (!key) continue
    if (compactMatchId(String(row.active_match_id ?? '')) !== target) continue
    const updatedAt = row.updated_at ? Date.parse(String(row.updated_at)) : NaN
    if (Number.isFinite(updatedAt) && now - updatedAt > CHAT_PRESENCE_TTL_MS) continue
    skip.add(key)
  }
  return skip
}

export async function sendWebPushToUser(
  userId: string,
  payload: WebPushPayload,
  options: typeof PUSH_PAYLOAD_OPTIONS | typeof PUSH_OPTIONS_BROADCAST = PUSH_PAYLOAD_OPTIONS,
  filter?: SendWebPushFilter,
): Promise<{ sent: number; failed: number; skipped: number }> {
  configureWebPush()
  const supabase = adminSupabase()
  let query = supabase
    .from('push_subscriptions')
    .select('endpoint, p256dh, auth, client_key')
    .eq('user_id', userId)
  const clientKey = filter?.clientKey?.trim()
  if (clientKey) query = query.eq('client_key', clientKey)

  const { data: rows, error } = await query

  if (error) throw error
  if (!rows?.length) return { sent: 0, failed: 0, skipped: 0 }

  const payloadText = buildPushPayloadText(payload)

  let sent = 0
  let failed = 0
  for (const r of rows as PushSubscriptionRow[]) {
    const out = await sendToSubscription(supabase, r, payloadText, options)
    if (out === 'ok') sent++
    else failed++
  }
  return { sent, failed, skipped: 0 }
}

/** 聊天／訊息類：server presence 略過 + SW 前景抑制；較高 urgency */
export async function sendWebPushMessageToUser(
  userId: string,
  payload: WebPushPayload,
): Promise<{ sent: number; failed: number; skipped: number }> {
  configureWebPush()
  const supabase = adminSupabase()
  const matchRaw = payload.matchId ?? payload.refMatchId
  const skipClientKeys = await resolveChatPresenceSkipClientKeys(supabase, userId, matchRaw)

  const { data: rows, error } = await supabase
    .from('push_subscriptions')
    .select('endpoint, p256dh, auth, client_key')
    .eq('user_id', userId)

  if (error) throw error
  if (!rows?.length) return { sent: 0, failed: 0, skipped: 0 }

  const badgeCount = await fetchUserMatchUnreadTotal(supabase, userId)
  const payloadText = buildPushPayloadText({ ...payload, badgeCount })
  const options = { TTL: 86_400, urgency: 'high' as const }

  let sent = 0
  let failed = 0
  let skipped = 0
  for (const r of rows as PushSubscriptionRow[]) {
    const ck = typeof r.client_key === 'string' ? r.client_key.trim() : ''
    if (ck && skipClientKeys.has(ck)) {
      skipped++
      continue
    }
    const out = await sendToSubscription(supabase, r, payloadText, options)
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
    url: `/?tab=discover&fromPush=1&pushTs=${Date.now()}`,
  })

  /** 並行發送以降低 Vercel serverless 逾時造成「後段訂閱全沒發到」 */
  const pageSize = 500
  /** 同一批內併發數；換日廣播須在 22:00 後短時間內送完，避免後段訂閱延遲數十分鐘才收到 */
  const concurrency = 64
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
