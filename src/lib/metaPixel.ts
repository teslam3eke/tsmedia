import type { User } from '@supabase/supabase-js'

const META_PIXEL_ID = (import.meta.env.VITE_META_PIXEL_ID ?? '').trim()
const REG_DEDUPE_PREFIX = 'tm_meta_reg_v1_'
const NEW_ACCOUNT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000

type FbqStub = {
  (...args: unknown[]): void
  queue: unknown[]
  loaded: boolean
  version: string
  callMethod?: (...args: unknown[]) => void
}

declare global {
  interface Window {
    fbq?: FbqStub
    _fbq?: FbqStub
  }
}

function pixelEnabled(): boolean {
  return typeof window !== 'undefined' && META_PIXEL_ID.length > 0
}

function fbq(...args: unknown[]): void {
  window.fbq?.(...args)
}

/** 載入 Meta Pixel base code 並送 PageView（需設 VITE_META_PIXEL_ID）。 */
export function initMetaPixel(): void {
  if (!pixelEnabled() || window.fbq) return

  const stub: FbqStub = Object.assign(
    function (...args: unknown[]) {
      if (stub.callMethod) {
        stub.callMethod(...args)
      } else {
        stub.queue.push(args)
      }
    },
    { queue: [] as unknown[], loaded: true, version: '2.0' },
  )

  if (!window._fbq) window._fbq = stub
  window.fbq = stub

  const script = document.createElement('script')
  script.async = true
  script.src = 'https://connect.facebook.net/en_US/fbevents.js'
  const first = document.getElementsByTagName('script')[0]
  first?.parentNode?.insertBefore(script, first)

  fbq('init', META_PIXEL_ID)
  fbq('track', 'PageView')
}

export function trackMetaEvent(eventName: string, params?: Record<string, unknown>): void {
  if (!pixelEnabled()) return
  initMetaPixel()
  if (params) {
    fbq('track', eventName, params)
  } else {
    fbq('track', eventName)
  }
}

function registrationAlreadyTracked(userId?: string | null): boolean {
  if (!userId) return false
  try {
    return localStorage.getItem(`${REG_DEDUPE_PREFIX}${userId}`) === '1'
  } catch {
    return false
  }
}

function markRegistrationTracked(userId?: string | null): void {
  if (!userId) return
  try {
    localStorage.setItem(`${REG_DEDUPE_PREFIX}${userId}`, '1')
  } catch {
    /* 私密模式 */
  }
}

/** 註冊成功（同一 user id 只送一次，避免重複登入重複計轉換）。 */
export function trackMetaCompleteRegistration(userId?: string | null): void {
  if (!pixelEnabled() || registrationAlreadyTracked(userId)) return
  trackMetaEvent('CompleteRegistration')
  markRegistrationTracked(userId)
}

/**
 * Email 確認信／首次登入等路徑的備援：帳號建立 7 日內且尚未送過轉換時補送。
 * （按「申請加入」當下已送過則 dedupe 略過，不會重複計。）
 */
export function trackMetaCompleteRegistrationForRecentAccount(user: User): void {
  const created = Date.parse(user.created_at)
  if (!Number.isFinite(created) || Date.now() - created > NEW_ACCOUNT_WINDOW_MS) return
  trackMetaCompleteRegistration(user.id)
}
