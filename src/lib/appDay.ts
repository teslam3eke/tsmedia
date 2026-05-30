/**
 * App 「新的一天」：固定晚上 22:00（本地時區）切換。
 * 與 DB `app_day_key_now()`（Asia/Taipei）對齊時，請將使用者裝置設為台北時區或確保行為一致。
 */
export function getAppDayKey(date = new Date()): string {
  const shifted = new Date(date.getTime() - 22 * 60 * 60 * 1000)
  const y = shifted.getFullYear()
  const m = shifted.getMonth() + 1
  const d = shifted.getDate()
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

/** 台北曆日 yyyy-mm-dd（與換日推播 `tag` 後綴對齊）。 */
export function taipeiWallCalendarKey(d = new Date()): string {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d)
}

/** 離「app 日」切換（本地 22:00 邊界）還剩幾 ms；上限內無變化則回退 60s（避免異常鎖死）。 */
export function msUntilNextAppDayKeyChange(now = new Date(), capMs = 25 * 60 * 60 * 1000): number {
  const k0 = getAppDayKey(now)
  const step = 1000
  for (let delta = step; delta <= capMs; delta += step) {
    if (getAppDayKey(new Date(now.getTime() + delta)) !== k0) return delta
  }
  return 60_000
}

/**
 * 下一個 **Asia/Taipei 22:00:00** 距今 ms（台灣無夏令時間，恒為 UTC 當日 14:00）。
 * 探索換日推播準點用；與 Vercel Cron `0 14 * * *` 對齊。
 */
export function msUntilNextTaipei2200(now = new Date()): number {
  const todayKey = taipeiWallCalendarKey(now)
  const [y, m, d] = todayKey.split('-').map(Number)
  const tonightUtcMs = Date.UTC(y, m - 1, d, 14, 0, 0, 0)
  if (now.getTime() < tonightUtcMs) {
    return Math.max(0, tonightUtcMs - now.getTime())
  }
  const nextUtcMs = Date.UTC(y, m - 1, d + 1, 14, 0, 0, 0)
  return Math.max(0, nextUtcMs - now.getTime())
}

const DISCOVER_ROLLOVER_NOTIFIED_LS_PREFIX = 'tsm_discover_rollover_notified_'

/** 與 Cron／SW 推播 `tag` 後綴對齊（Asia/Taipei 曆日）。 */
export function discoverRolloverDedupeKey(d = new Date()): string {
  return taipeiWallCalendarKey(d)
}

export function markDiscoverRolloverNotified(dedupeKey: string): void {
  try {
    localStorage.setItem(`${DISCOVER_ROLLOVER_NOTIFIED_LS_PREFIX}${dedupeKey}`, '1')
  } catch {
    /* private mode — 不中斷 */
  }
}

export function wasDiscoverRolloverNotified(dedupeKey: string): boolean {
  try {
    return localStorage.getItem(`${DISCOVER_ROLLOVER_NOTIFIED_LS_PREFIX}${dedupeKey}`) === '1'
  } catch {
    return false
  }
}

/**
 * 換日（Asia/Taipei 22:00:00）推一則系統推播；同一曆日只發一次。
 * 需使用者已允許 Notification；iOS PWA 以 service worker 顯示為佳。
 *
 * App 有執行中 JS 時由 `msUntilNextTaipei2200` 準點呼叫；完全未開啟時由 Vercel Cron Web Push 補送（Cron 僅能到分鐘級，可能略晚）。
 * SW 收到 Cron 推播時若同 tag 已顯示則略過，避免與準點本地通知重複。
 */
export async function showDiscoverDeckRolloverNotification(_dayKey: string): Promise<void> {
  if (typeof window === 'undefined' || !('Notification' in window)) return
  if (Notification.permission !== 'granted') return
  const dedupeKey = discoverRolloverDedupeKey()
  if (wasDiscoverRolloverNotified(dedupeKey)) return
  markDiscoverRolloverNotified(dedupeKey)
  const title = '探索名單已更新'
  const body = '每日晚上 10 點換日，今日配對推薦已重新產生。'
  const options: NotificationOptions & { renotify?: boolean } = {
    body,
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    tag: `tsm-discover-deck-day-${dedupeKey}`,
    renotify: false,
  }
  try {
    if ('serviceWorker' in navigator) {
      const reg = await navigator.serviceWorker.ready
      await reg.showNotification(title, options)
    } else {
      new Notification(title, options)
    }
  } catch {
    try {
      new Notification(title, options)
    } catch {
      /* ignore */
    }
  }
}
