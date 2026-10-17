import crypto from 'node:crypto'

const GRAPH_VERSION = 'v21.0'
/** Vercel：await 送達，但不宜超過 function 剩餘時間；6s 為合理上限。 */
export const META_CAPI_REQUEST_TIMEOUT_MS = 6_000

export type MetaCapiUserDataInput = {
  externalId: string
  email?: string | null
  fbp?: string | null
  fbc?: string | null
  clientIpAddress?: string | null
  clientUserAgent?: string | null
}

export type MetaCapiPurchasePayload = MetaCapiUserDataInput & {
  eventId: string
  eventTimeSec: number
  eventSourceUrl?: string | null
  valueNtd: number
  currency: string
  orderId: string
}

export type MetaCapiStandardEventPayload = MetaCapiUserDataInput & {
  eventName: string
  eventId: string
  eventTimeSec: number
  eventSourceUrl?: string | null
  customData?: Record<string, unknown>
}

export function normalizeMetaEmail(raw: string): string {
  return raw.trim().toLowerCase()
}

/** Meta：email 等 PII 需 SHA-256（hex，小寫輸入）。 */
export function sha256MetaNormalized(value: string): string {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex')
}

/** external_id：對 UUID 等內部 ID 做 SHA-256。 */
export function hashMetaExternalId(userId: string): string {
  const id = userId.trim()
  if (!id) return ''
  return crypto.createHash('sha256').update(id, 'utf8').digest('hex')
}

export function sanitizeMetaFbp(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const v = raw.trim()
  if (v.length < 8 || v.length > 256) return null
  if (!v.startsWith('fb.')) return null
  return v
}

export function sanitizeMetaFbc(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const v = raw.trim()
  if (v.length < 8 || v.length > 512) return null
  if (!v.startsWith('fb.')) return null
  return v
}

export const META_EVENT_SOURCE_URL_FALLBACK = 'https://tsmedia.tw/'

const META_EVENT_SOURCE_ALLOWED_HOSTS = new Set(['tsmedia.tw', 'www.tsmedia.tw'])

/**
 * Server CAPI event_source_url：僅允許 tsmedia.tw / www.tsmedia.tw、https、無 query/hash。
 */
export function sanitizeMetaEventSourceUrl(raw: unknown): string {
  if (typeof raw !== 'string') return META_EVENT_SOURCE_URL_FALLBACK
  const trimmed = raw.trim()
  if (!trimmed) return META_EVENT_SOURCE_URL_FALLBACK

  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    return META_EVENT_SOURCE_URL_FALLBACK
  }

  if (url.protocol !== 'https:') return META_EVENT_SOURCE_URL_FALLBACK
  const host = url.hostname.toLowerCase()
  if (!META_EVENT_SOURCE_ALLOWED_HOSTS.has(host)) return META_EVENT_SOURCE_URL_FALLBACK
  if (url.username || url.password) return META_EVENT_SOURCE_URL_FALLBACK

  url.search = ''
  url.hash = ''
  const path = url.pathname || '/'
  return `https://${host}${path}`
}

function readCapiConfig(): { pixelId: string; accessToken: string; testEventCode: string | null } | null {
  const accessToken = process.env.META_CAPI_ACCESS_TOKEN?.trim()
  const pixelId = process.env.META_PIXEL_ID?.trim()
  if (!accessToken || !pixelId) return null
  const testEventCode = process.env.META_CAPI_TEST_EVENT_CODE?.trim() || null
  return { pixelId, accessToken, testEventCode }
}

export function buildMetaCapiUserData(input: MetaCapiUserDataInput): Record<string, unknown> {
  const userData: Record<string, unknown> = {
    external_id: [hashMetaExternalId(input.externalId)],
  }

  const email = input.email?.trim()
  if (email) {
    userData.em = [sha256MetaNormalized(normalizeMetaEmail(email))]
  }

  const fbp = sanitizeMetaFbp(input.fbp)
  if (fbp) userData.fbp = fbp

  const fbc = sanitizeMetaFbc(input.fbc)
  if (fbc) userData.fbc = fbc

  const ip = input.clientIpAddress?.trim()
  if (ip && /^[\d.a-fA-F:]+$/.test(ip) && ip.length <= 45) {
    userData.client_ip_address = ip
  }

  const ua = input.clientUserAgent?.trim()
  if (ua && ua.length <= 512) {
    userData.client_user_agent = ua
  }

  return userData
}

type MetaCapiPostResult = { ok: true } | { ok: false; skipped?: boolean; error: string }

async function postMetaCapiEvents(
  events: Record<string, unknown>[],
  logKind: string,
  eventIdForLog: string,
): Promise<MetaCapiPostResult> {
  const cfg = readCapiConfig()
  if (!cfg) {
    return { ok: false, skipped: true, error: 'meta_capi_not_configured' }
  }

  const body: Record<string, unknown> = { data: events }
  if (cfg.testEventCode) {
    body.test_event_code = cfg.testEventCode
  }

  const url = new URL(`https://graph.facebook.com/${GRAPH_VERSION}/${cfg.pixelId}/events`)
  url.searchParams.set('access_token', cfg.accessToken)

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), META_CAPI_REQUEST_TIMEOUT_MS)

  try {
    const res = await fetch(url.toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    })

    const text = await res.text()
    let json: { error?: { message?: string }; events_received?: number } | null = null
    try {
      json = JSON.parse(text) as { error?: { message?: string }; events_received?: number }
    } catch {
      /* ignore */
    }

    if (!res.ok) {
      const msg = json?.error?.message ?? `http_${res.status}`
      console.warn(`[meta-capi] ${logKind} failed`, {
        eventId: eventIdForLog,
        status: res.status,
        message: msg,
      })
      return { ok: false, error: msg }
    }

    const received = json?.events_received
    if (typeof received !== 'number' || received < 1) {
      console.warn(`[meta-capi] ${logKind} unexpected body`, {
        eventId: eventIdForLog,
        events_received: received,
      })
      return { ok: false, error: 'events_not_received' }
    }

    console.info(`[meta-capi] ${logKind} sent`, { eventId: eventIdForLog, events_received: received })
    return { ok: true }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'request_failed'
    console.warn(`[meta-capi] ${logKind} error`, { eventId: eventIdForLog, message: msg })
    return { ok: false, error: msg }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 標準事件 CAPI（CompleteRegistration、SubmitApplication 等）。fail-safe，不 throw。
 */
export async function sendMetaCapiStandardEvent(
  payload: MetaCapiStandardEventPayload,
): Promise<MetaCapiPostResult> {
  const eventId = payload.eventId.trim()
  const eventName = payload.eventName.trim()
  if (!eventId || !eventName) {
    return { ok: false, error: 'missing_event_id' }
  }

  const event: Record<string, unknown> = {
    event_name: eventName,
    event_time: payload.eventTimeSec,
    event_id: eventId,
    action_source: 'website',
    event_source_url: sanitizeMetaEventSourceUrl(payload.eventSourceUrl),
    user_data: buildMetaCapiUserData(payload),
  }
  if (payload.customData && Object.keys(payload.customData).length > 0) {
    event.custom_data = payload.customData
  }

  const logKind = eventName.replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase()
  return postMetaCapiEvents([event], logKind, eventId)
}

/**
 * 送 Meta Conversions API Purchase。fail-safe：錯誤只回傳，不 throw。
 * 不得 log token／email 明文。
 */
export async function sendMetaCapiPurchase(
  payload: MetaCapiPurchasePayload,
): Promise<MetaCapiPostResult> {
  const eventId = payload.eventId.trim()
  if (!eventId) {
    return { ok: false, error: 'missing_event_id' }
  }

  return postMetaCapiEvents(
    [
      {
        event_name: 'Purchase',
        event_time: payload.eventTimeSec,
        event_id: eventId,
        action_source: 'website',
        event_source_url: sanitizeMetaEventSourceUrl(payload.eventSourceUrl),
        user_data: buildMetaCapiUserData(payload),
        custom_data: {
          value: payload.valueNtd,
          currency: payload.currency,
          order_id: payload.orderId,
        },
      },
    ],
    'purchase',
    eventId,
  )
}
