/** LINE 式主畫面圖示角標（Badging API；iOS 16.4+ 加到主畫面的 PWA） */

const BADGE_MAX = 99

export function isAppIconBadgeSupported(): boolean {
  return typeof navigator !== 'undefined' && 'setAppBadge' in navigator
}

/** 同步未讀總數至主畫面圖示；0 時清除角標。 */
export async function syncAppIconBadge(unreadTotal: number): Promise<void> {
  const n = Math.max(0, Math.min(BADGE_MAX, Math.floor(unreadTotal)))
  try {
    const sw = navigator.serviceWorker?.controller
    if (sw) {
      /** 統一由 SW registration 寫角標，避免 navigator + registration 在 iOS 被加總 */
      sw.postMessage({ type: 'TM_BADGE_SYNC', count: n })
      return
    }
    if (isAppIconBadgeSupported()) {
      if (n <= 0) await navigator.clearAppBadge!()
      else await navigator.setAppBadge!(n)
    }
  } catch {
    /* iOS 不支援或權限限制 */
  }
}

export async function clearAppIconBadge(): Promise<void> {
  await syncAppIconBadge(0)
}
