/**
 * iOS／PWA 回前景後 fetch／WS 僵死難根治時，用最接近「整頁冷啟」的方式恢復；
 * 僅在行動環境開啟，且可用 `?noHardResume=1` 或 `sessionStorage tm_no_hard_resume=1` 關閉以便除錯。
 */

const STORAGE_DISABLE_KEY = 'tm_no_hard_resume'

export function resumeHardReloadDisabledGlobally(): boolean {
  try {
    if (new URLSearchParams(window.location.search).get('noHardResume') === '1') {
      sessionStorage.setItem(STORAGE_DISABLE_KEY, '1')
    }
    return sessionStorage.getItem(STORAGE_DISABLE_KEY) === '1'
  } catch {
    return false
  }
}

/** 桌面版不必每次回前景就整頁重載（體驗差）；僅在行動／PWA 視為需要。 */
export function hostLikelyNeedsResumeHardReload(): boolean {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent.toLowerCase()
  if (/iphone|ipad|ipod|android/.test(ua)) return true
  try {
    if (window.matchMedia('(display-mode: standalone)').matches) return true
    if (window.matchMedia('(display-mode: fullscreen)').matches) return true
  } catch {
    /* ignore */
  }
  return false
}
