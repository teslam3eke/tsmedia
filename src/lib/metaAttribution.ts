const FBC_COOKIE = '_fbc'
const FBP_COOKIE = '_fbp'
const FBCLID_STORAGE = 'tm_meta_fbclid_v1'

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

/** 自 landing URL 擷取 fbclid 並建立 Meta 格式 _fbc cookie。 */
export function captureMetaClickIdFromUrl(): void {
  if (typeof window === 'undefined') return
  try {
    const params = new URLSearchParams(window.location.search)
    const fbclid = params.get('fbclid')?.trim()
    if (!fbclid) return
    sessionStorage.setItem(FBCLID_STORAGE, fbclid)
    const existing = readCookie(FBC_COOKIE)
    if (existing?.includes(fbclid)) return
    const ts = Math.floor(Date.now() / 1000)
    writeCookie(FBC_COOKIE, `fb.1.${ts}.${fbclid}`, 90 * 24 * 3600)
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
    const ts = Math.floor(Date.now() / 1000)
    return `fb.1.${ts}.${fbclid}`
  } catch {
    return null
  }
}

export function getMetaAttributionPayload(): { metaFbp: string | null; metaFbc: string | null } {
  return { metaFbp: getMetaFbp(), metaFbc: getMetaFbc() }
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
export async function requestMetaCompleteRegistrationCapi(accessToken: string): Promise<void> {
  const { metaFbp, metaFbc } = getMetaAttributionPayload()
  try {
    await fetch('/api/meta-capi-complete-registration', {
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

/** 先同步 attribution 再送 CompleteRegistration CAPI（註冊／信箱確認後 session 就緒時）。 */
export async function syncMetaAttributionAndCompleteRegistrationCapi(
  accessToken: string,
): Promise<void> {
  await syncMetaAttributionToServer(accessToken)
  await requestMetaCompleteRegistrationCapi(accessToken)
}
