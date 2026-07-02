/** 非正式站標記（Vercel Preview／staging 子網域等） */
export function isStagingAppEnv(): boolean {
  return import.meta.env.VITE_APP_ENV?.trim().toLowerCase() === 'staging'
}

/** 正式 DB 開維護時，測試站仍可進站（共用 Supabase 時必設） */
export function shouldIgnoreSiteMaintenance(): boolean {
  return import.meta.env.VITE_IGNORE_SITE_MAINTENANCE === '1'
}
