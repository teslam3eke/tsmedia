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

/**
 * 換日（每晚 22:00 後 app 日切換）時推一則系統推播；同一 app 日只發一次。
 * 需使用者已允許 Notification；iOS PWA 以 service worker 顯示為佳。
 */
export async function showDiscoverDeckRolloverNotification(dayKey: string): Promise<void> {
  if (typeof window === 'undefined' || !('Notification' in window)) return
  if (Notification.permission !== 'granted') return
  const mark = `tsm_discover_rollover_notified_${dayKey}`
  if (sessionStorage.getItem(mark) === '1') return
  sessionStorage.setItem(mark, '1')
  const title = '探索名單已更新'
  const body = '每日晚上 10 點換日，今日配對推薦已重新產生。'
  const options: NotificationOptions & { renotify?: boolean } = {
    body,
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    tag: 'tsm-discover-deck-day',
    renotify: true,
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
