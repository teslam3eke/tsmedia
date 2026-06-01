/** LINE 式主畫面圖示角標（Badging API；iOS 16.4+ 加到主畫面的 PWA） */

const BADGE_MAX = 99

export function isAppIconBadgeSupported(): boolean {
  return typeof navigator !== 'undefined' && 'setAppBadge' in navigator
}

async function postBadgeSyncToServiceWorker(n: number): Promise<void> {
  if (!('serviceWorker' in navigator)) return
  const msg = { type: 'TM_BADGE_SYNC' as const, count: n }
  const controller = navigator.serviceWorker.controller
  if (controller) {
    controller.postMessage(msg)
    return
  }
  try {
    const reg = await navigator.serviceWorker.ready
    reg.active?.postMessage(msg)
  } catch {
    /* ignore */
  }
}

/** 同步未讀總數至主畫面圖示；0 時清除角標。 */
export async function syncAppIconBadge(unreadTotal: number): Promise<void> {
  const n = Math.max(0, Math.min(BADGE_MAX, Math.floor(unreadTotal)))
  try {
    /** 前景／App 開啟時由 navigator 更新；勿省略（否則 iOS 角標可能卡在舊值） */
    if (isAppIconBadgeSupported()) {
      if (n <= 0) await navigator.clearAppBadge!()
      else await navigator.setAppBadge!(n)
    }
    /** 對齊 SW cache + registration（背景推播 baseline）；勿在 SW 內再寫 navigator */
    await postBadgeSyncToServiceWorker(n)
  } catch {
    /* iOS 不支援或權限限制 */
  }
}

export async function clearAppIconBadge(): Promise<void> {
  await syncAppIconBadge(0)
}
