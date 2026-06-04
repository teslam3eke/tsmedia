import { isIosNonSafariBrowser } from '@/lib/authBrowser'

const SITE_FALLBACK = 'https://www.tsmedia.tw/'

/** 要交給 Safari 開啟的 https 網址（含確認信 ?code= 等）。 */
export function resolveTsMediaOpenUrl(preferred?: string): string {
  const raw = preferred?.trim()
  if (raw) {
    try {
      return new URL(raw).href
    } catch {
      /* fall through */
    }
  }
  if (typeof window !== 'undefined') return window.location.href
  const fromEnv = import.meta.env.VITE_SITE_URL?.trim().replace(/\/$/, '')
  if (fromEnv) return `${fromEnv}/`
  return SITE_FALLBACK
}

/**
 * iOS 非官方深層連結（部分版本 Chrome 內可嘗試跳轉 Safari）。
 * 無保證；Apple 未公開文件化，失敗時須改用手動複製貼上。
 */
export function buildIosSafariDeepLink(httpsUrl: string): string | null {
  try {
    const u = new URL(httpsUrl)
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null
    const scheme = u.protocol === 'https:' ? 'x-safari-https' : 'x-safari-http'
    return `${scheme}://${u.host}${u.pathname}${u.search}${u.hash}`
  } catch {
    return null
  }
}

export function canAttemptIosSafariHandoff(): boolean {
  return isIosNonSafariBrowser()
}

export type TryOpenInIosSafariResult =
  | { ok: true; deepLink: string; httpsUrl: string }
  | { ok: false; reason: 'not_ios_chrome' | 'invalid_url' }

/** 以隱藏 `<a click>` 觸發系統是否願意交給 Safari（須在使用者點擊手勢內呼叫）。 */
export function tryOpenUrlInIosSafari(httpsUrl: string): TryOpenInIosSafariResult {
  if (!canAttemptIosSafariHandoff()) {
    return { ok: false, reason: 'not_ios_chrome' }
  }
  const deepLink = buildIosSafariDeepLink(httpsUrl)
  if (!deepLink) return { ok: false, reason: 'invalid_url' }

  const anchor = document.createElement('a')
  anchor.href = deepLink
  anchor.rel = 'noopener noreferrer'
  anchor.style.display = 'none'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()

  return { ok: true, deepLink, httpsUrl }
}

export async function copyUrlForSafariFallback(httpsUrl: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(httpsUrl)
    return true
  } catch {
    return false
  }
}
