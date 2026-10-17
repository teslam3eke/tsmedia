import { isRegistrationCapiWindowOpen } from '@/lib/metaCapiRegistrationWindow'
import { buildFbcValue, fbclidFromFbcValue } from '@/lib/metaFbcFormat'

const FBC_COOKIE = '_fbc'
const FBP_COOKIE = '_fbp'
const FBCLID_STORAGE = 'tm_meta_fbclid_v1'
const FBCLID_TS_STORAGE = 'tm_meta_fbclid_ts_v1'
const REG_CAPI_PENDING_PREFIX = 'tm_reg_capi_pending_v1_'

function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null
  const parts = document.cookie.split(';')
  for (const part of parts) {
    const [k, ...rest] = part.trim().split('=')
    if (k === name) {
      const v = decodeURIComponent(rest.join('=')).trim()
      return v || null
    }
  }
  return null
}

function writeCookie(name: string, value: string, maxAgeSec: number): void {
  if (typeof document === 'undefined') return
  const secure = typeof location !== 'undefined' && location.protocol === 'https:' ? '; Secure' : ''
  document.cookie = `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAgeSec}; SameSite=Lax${secure}`
}

/** 事件發生當下頁面 URL（由 server sanitize）。 */
export function getClientMetaEventSourceUrl(): string {
  if (typeof window === 'undefined') return ''
  try {
    return window.location.href
  } catch {
    return ''
  }
}

/** 自 landing URL 擷取 fbclid 並建立 Meta 格式 _fbc cookie。 */
export function captureMetaClickIdFromUrl(): void {
  if (typeof window === 'undefined') return
  try {
    const params = new URLSearchParams(window.location.search)
    const fbclid = params.get('fbclid')?.trim()
    if (!fbclid) return

    const existing = readCookie(FBC_COOKIE)
    if (existing) {
      const existingClid = fbclidFromFbcValue(existing)
      if (existingClid === fbclid) return
    }

    const ts = Math.floor(Date.now() / 1000)
    sessionStorage.setItem(FBCLID_STORAGE, fbclid)
    sessionStorage.setItem(FBCLID_TS_STORAGE, String(ts))
    writeCookie(FBC_COOKIE, buildFbcValue(fbclid, ts), 90 * 24 * 3600)
  } catch {
    /* 私密模式 */
  }
}

export function getMetaFbp(): string | null {
  return readCookie(FBP_COOKIE)
}

export function getMetaFbc(): string | null {
  const fromCookie = readCookie(FBC_COOKIE)
  if (fromCookie) return fromCookie
  try {
    const fbclid = sessionStorage.getItem(FBCLID_STORAGE)?.trim()
    if (!fbclid) return null
    const storedTs = sessionStorage.getItem(FBCLID_TS_STORAGE)?.trim()
    const ts = storedTs ? Number.parseInt(storedTs, 10) : NaN
    const creationTimeSec = Number.isFinite(ts) ? ts : Math.floor(Date.now() / 1000)
    return buildFbcValue(fbclid, creationTimeSec)
  } catch {
    return null
  }
}

export function getMetaAttributionPayload(): { metaFbp: string | null; metaFbc: string | null } {
  return { metaFbp: getMetaFbp(), metaFbc: getMetaFbc() }
}

export type RegistrationCapiSnapshot = {
  metaFbp: string | null
  metaFbc: string | null
  eventSourceUrl: string
  registeredAt: string
}

function registrationCapiPendingKey(userId: string): string {
  return `${REG_CAPI_PENDING_PREFIX}${userId}`
}

/** 註冊成功時凍結 client 快照（含待 email 確認路徑）。 */
export function markRegistrationCapiPending(userId: string, registeredAt: string): void {
  if (typeof localStorage === 'undefined') return
  const { metaFbp, metaFbc } = getMetaAttributionPayload()
  const payload: RegistrationCapiSnapshot = {
    metaFbp,
    metaFbc,
    eventSourceUrl: getClientMetaEventSourceUrl(),
    registeredAt,
  }
  try {
    localStorage.setItem(registrationCapiPendingKey(userId), JSON.stringify(payload))
  } catch {
    /* ignore */
  }
}

export function clearRegistrationCapiPending(userId: string): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.removeItem(registrationCapiPendingKey(userId))
  } catch {
    /* ignore */
  }
}

function readRegistrationCapiPending(userId: string): RegistrationCapiSnapshot | null {
  if (typeof localStorage === 'undefined') return null
  try {
    const raw = localStorage.getItem(registrationCapiPendingKey(userId))
    if (!raw) return null
    const o = JSON.parse(raw) as RegistrationCapiSnapshot
    if (!o || typeof o.registeredAt !== 'string') return null
    return {
      metaFbp: typeof o.metaFbp === 'string' ? o.metaFbp : null,
      metaFbc: typeof o.metaFbc === 'string' ? o.metaFbc : null,
      eventSourceUrl: typeof o.eventSourceUrl === 'string' ? o.eventSourceUrl : '',
      registeredAt: o.registeredAt,
    }
  } catch {
    return null
  }
}

/** 登入後同步至 profiles（跨 session；失敗不阻擋 UI）。 */
export async function syncMetaAttributionToServer(accessToken: string): Promise<void> {
  const { metaFbp, metaFbc } = getMetaAttributionPayload()
  if (!metaFbp && !metaFbc) return
  try {
    await fetch('/api/meta-attribution', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ metaFbp, metaFbc }),
      cache: 'no-store',
    })
  } catch {
    /* ignore */
  }
}

/** CompleteRegistration Server CAPI（JWT + event_id=user.id；失敗不阻擋 UI）。 */
export async function requestMetaCompleteRegistrationCapi(
  accessToken: string,
  snapshot?: RegistrationCapiSnapshot,
): Promise<boolean> {
  const metaFbp = snapshot?.metaFbp ?? getMetaAttributionPayload().metaFbp
  const metaFbc = snapshot?.metaFbc ?? getMetaAttributionPayload().metaFbc
  const eventSourceUrl = snapshot?.eventSourceUrl || getClientMetaEventSourceUrl()
  try {
    const res = await fetch('/api/meta-capi-complete-registration', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ metaFbp, metaFbc, eventSourceUrl }),
      cache: 'no-store',
    })
    return res.ok
  } catch {
    return false
  }
}

/**
 * 僅在註冊流程留下的 pending 快照存在且仍在 7 日窗口內時補送 CAPI（email 確認等）。
 * 一般舊帳號 login 不會觸發。
 */
export async function tryDeliverRegistrationCapiFromPending(
  accessToken: string,
  user: { id: string; created_at?: string },
): Promise<void> {
  const pending = readRegistrationCapiPending(user.id)
  if (!pending) return

  const registeredAt = pending.registeredAt || user.created_at
  if (!registeredAt || !isRegistrationCapiWindowOpen(registeredAt)) {
    clearRegistrationCapiPending(user.id)
    return
  }

  const ok = await requestMetaCompleteRegistrationCapi(accessToken, pending)
  if (ok) clearRegistrationCapiPending(user.id)
}

/** 登入／session 就緒：同步 attribution；僅 pending 註冊才送 CompleteRegistration CAPI。 */
export async function syncMetaAttributionAfterAuth(
  accessToken: string,
  user: { id: string; created_at?: string },
): Promise<void> {
  await syncMetaAttributionToServer(accessToken)
  await tryDeliverRegistrationCapiFromPending(accessToken, user)
}
