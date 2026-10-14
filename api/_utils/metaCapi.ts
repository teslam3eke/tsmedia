import crypto from 'node:crypto'

const GRAPH_VERSION = 'v21.0'
/** Vercel：await 送達，但不宜超過 function 剩餘時間；6s 為合理上限。 */
export const META_CAPI_REQUEST_TIMEOUT_MS = 6_000

export type MetaCapiPurchasePayload = {
  eventId: string
  eventTimeSec: number
  valueNtd: number
  currency: string
  orderId: string
  externalId: string
  email?: string | null
  fbp?: string | null
  fbc?: string | null
  clientIpAddress?: string | null
  clientUserAgent?: string | null
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

function readCapiConfig(): { pixelId: string; accessToken: string; testEventCode: string | null } | null {
  const accessToken = process.env.META_CAPI_ACCESS_TOKEN?.trim()
  const pixelId = process.env.META_PIXEL_ID?.trim()
  if (!accessToken || !pixelId) return null
  const testEventCode = process.env.META_CAPI_TEST_EVENT_CODE?.trim() || null
  return { pixelId, accessToken, testEventCode }
}

/**
 * 送 Meta Conversions API Purchase。fail-safe：錯誤只回傳，不 throw。
 * 不得 log token／email 明文。
 */
export async function sendMetaCapiPurchase(
  payload: MetaCapiPurchasePayload,
): Promise<{ ok: true } | { ok: false; skipped?: boolean; error: string }> {
  const cfg = readCapiConfig()
  if (!cfg) {
    return { ok: false, skipped: true, error: 'meta_capi_not_configured' }
  }

  const eventId = payload.eventId.trim()
  if (!eventId) {
    return { ok: false, error: 'missing_event_id' }
  }

  const userData: Record<string, unknown> = {
    external_id: [hashMetaExternalId(payload.externalId)],
  }

  const email = payload.email?.trim()
  if (email) {
    userData.em = [sha256MetaNormalized(normalizeMetaEmail(email))]
  }

  const fbp = sanitizeMetaFbp(payload.fbp)
  if (fbp) userData.fbp = fbp

  const fbc = sanitizeMetaFbc(payload.fbc)
  if (fbc) userData.fbc = fbc

  const ip = payload.clientIpAddress?.trim()
  if (ip && /^[\d.a-fA-F:]+$/.test(ip) && ip.length <= 45) {
    userData.client_ip_address = ip
  }

  const ua = payload.clientUserAgent?.trim()
  if (ua && ua.length <= 512) {
    userData.client_user_agent = ua
  }

  const body: Record<string, unknown> = {
    data: [
      {
        event_name: 'Purchase',
        event_time: payload.eventTimeSec,
        event_id: eventId,
        action_source: 'website',
        user_data: userData,
        custom_data: {
          value: payload.valueNtd,
          currency: payload.currency,
          order_id: payload.orderId,
        },
      },
    ],
  }

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
      console.warn('[meta-capi] purchase failed', { eventId, status: res.status, message: msg })
      return { ok: false, error: msg }
    }

    const received = json?.events_received
    if (typeof received !== 'number' || received < 1) {
      console.warn('[meta-capi] purchase unexpected body', { eventId, events_received: received })
      return { ok: false, error: 'events_not_received' }
    }

    console.info('[meta-capi] purchase sent', { eventId, events_received: received })
    return { ok: true }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'request_failed'
    console.warn('[meta-capi] purchase error', { eventId, message: msg })
    return { ok: false, error: msg }
  } finally {
    clearTimeout(timer)
  }
}
