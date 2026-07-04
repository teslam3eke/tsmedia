/** 非正式站標記（Vercel Preview／staging 子網域等） */
export function isStagingAppEnv(): boolean {
  return import.meta.env.VITE_APP_ENV?.trim().toLowerCase() === 'staging'
}

/** 正式 DB 開維護時，測試站仍可進站（共用 Supabase 時必設） */
export function shouldIgnoreSiteMaintenance(): boolean {
  return import.meta.env.VITE_IGNORE_SITE_MAINTENANCE === '1'
}

/**
 * 本機 dev 或 LAN HTTP（非 secure context）無法可靠取得通知權限；
 * 略過反覆彈出的「開啟通知」引導。
 */
export function shouldSkipNotificationNudge(): boolean {
  if (import.meta.env.DEV) return true
  if (import.meta.env.VITE_SKIP_NOTIF_NUDGE === '1') return true
  if (typeof window !== 'undefined' && !window.isSecureContext) return true
  return false
}
