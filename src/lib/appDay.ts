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
 * 換日（每晚 22:00 後 app 日切換）時推一則系統推播；同一 app 日只發一次。
 * 需使用者已允許 Notification；iOS PWA 以 service worker 顯示為佳。
 *
 * 僅在 **此行有執行中 JS（曾開啟 PWA 或仍於前景）** 時才會被呼叫；APP 完全未開啟或 OS 凍結 JS 時無法準點發送。
 * 若要在鎖屏／未開啟 APP 仍於 22:00 收到通知，須由 **伺服器發 Web Push**，單靠前端 timer 無法達成。
 */export async function showDiscoverDeckRolloverNotification(dayKey: string): Promise<void> {
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
