/** Email CTA 進站來源（無 PII；供未來 ApprovedReturn 分析） */

export const EMAIL_LAUNCH_FROM_PARAM = 'fromEmail'
export const EMAIL_LAUNCH_APPROVAL_VALUE = 'approval'

const STORAGE_KEY = 'tm_email_launch_source_v1'
/** 與推播 launch token 同量級：短期 attribution */
export const EMAIL_LAUNCH_MAX_AGE_MS = 7 * 24 * 3600 * 1000

export type EmailLaunchSource = {
  kind: typeof EMAIL_LAUNCH_APPROVAL_VALUE
  capturedAtMs: number
}

export function captureEmailLaunchSourceFromUrl(): void {
  if (typeof window === 'undefined') return
  try {
    const params = new URLSearchParams(window.location.search)
    const from = params.get(EMAIL_LAUNCH_FROM_PARAM)?.trim()
    if (from !== EMAIL_LAUNCH_APPROVAL_VALUE) return

    const payload: EmailLaunchSource = {
      kind: EMAIL_LAUNCH_APPROVAL_VALUE,
      capturedAtMs: Date.now(),
    }
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
    stripEmailLaunchParamFromUrl()
  } catch {
    /* 私密模式 */
  }
}

export function readEmailLaunchSource(maxAgeMs = EMAIL_LAUNCH_MAX_AGE_MS): EmailLaunchSource | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const o = JSON.parse(raw) as EmailLaunchSource
    if (o?.kind !== EMAIL_LAUNCH_APPROVAL_VALUE) return null
    if (!Number.isFinite(o.capturedAtMs)) return null
    if (Date.now() - o.capturedAtMs > maxAgeMs) {
      sessionStorage.removeItem(STORAGE_KEY)
      return null
    }
    return o
  } catch {
    return null
  }
}

export function clearEmailLaunchSource(): void {
  try {
    sessionStorage.removeItem(STORAGE_KEY)
  } catch {
    /* ignore */
  }
}

/** 保存 attribution 後自 URL 移除 fromEmail（不影響其他 query） */
export function stripEmailLaunchParamFromUrl(): void {
  if (typeof window === 'undefined') return
  const url = new URL(window.location.href)
  if (!url.searchParams.has(EMAIL_LAUNCH_FROM_PARAM)) return
  url.searchParams.delete(EMAIL_LAUNCH_FROM_PARAM)
  const rest = url.searchParams.toString()
  window.history.replaceState({}, '', url.pathname + (rest ? `?${rest}` : '') + url.hash)
}

/** CTA 是否在 PWA manifest scope 內（目前 scope=/） */
export function isEmailCtaPathInPwaScope(pathname: string): boolean {
  const path = pathname.startsWith('/') ? pathname : `/${pathname}`
  return path === '/' || path.startsWith('/')
}
