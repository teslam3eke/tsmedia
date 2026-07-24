/** 測試期間暫時全天開放；恢復正式營運時改回 false。 */
const TEMPORARILY_ALWAYS_OPEN = true

export const INSTANT_MATCH_HOURS_LABEL = TEMPORARILY_ALWAYS_OPEN
  ? '測試期間全天開放'
  : '每晚 22:00 至隔日 01:00（台灣時間）'

export const INSTANT_MATCH_CLOSED_HINT =
  `即時配對僅在${INSTANT_MATCH_HOURS_LABEL}開放。`

function taipeiHourMinute(date: Date): { hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Taipei',
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
  }).formatToParts(date)
  return {
    hour: Number(parts.find((p) => p.type === 'hour')?.value ?? 0),
    minute: Number(parts.find((p) => p.type === 'minute')?.value ?? 0),
  }
}

/** 與 DB `instant_match_open_now()`／instant_match_always_open 旗標對齊。 */
export function instantMatchAlwaysOpenForTesting(): boolean {
  return TEMPORARILY_ALWAYS_OPEN || import.meta.env.VITE_INSTANT_MATCH_ALWAYS_OPEN === '1'
}

export function isInstantMatchOpenNow(date = new Date()): boolean {
  if (instantMatchAlwaysOpenForTesting()) return true
  const { hour } = taipeiHourMinute(date)
  return hour >= 22 || hour < 1
}

export function msUntilInstantMatchOpens(now = new Date(), capMs = 24 * 60 * 60 * 1000): number {
  if (isInstantMatchOpenNow(now)) return 0
  const step = 60_000
  for (let delta = step; delta <= capMs; delta += step) {
    if (isInstantMatchOpenNow(new Date(now.getTime() + delta))) return delta
  }
  return step
}

export function formatMsUntilInstantMatchOpens(ms: number): string {
  const totalMin = Math.max(1, Math.ceil(ms / 60_000))
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  if (h > 0 && m > 0) return `${h} 小時 ${m} 分鐘`
  if (h > 0) return `${h} 小時`
  return `${m} 分鐘`
}
