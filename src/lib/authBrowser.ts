import { iosOrIpadosLikely } from '@/lib/resumeHardReload'

/**
 * iOS 上 Chrome／Firefox／Edge 等（UA 含 CriOS 等）。
 * Email 內建瀏覽器多為 WebKit 但 storage 可能與 Safari PWA 不同；PKCE 失敗時另由 auth 引導。
 */
export function isIosNonSafariBrowser(): boolean {
  if (!iosOrIpadosLikely()) return false
  const ua = navigator.userAgent || ''
  return /CriOS|FxiOS|EdgiOS|OPiOS|DuckDuckGo/i.test(ua)
}

/** iOS 非 Safari（Chrome 等）：須阻擋進入後續流程 */
export function needsIosSafariBrowserGate(): boolean {
  return isIosNonSafariBrowser()
}

/** iOS 非 Safari（Chrome 等）：每次冷啟／重新整理應顯示警示（已改為全螢幕閘門） */
export function shouldWarnIosNonSafariBrowser(): boolean {
  return needsIosSafariBrowserGate()
}

/** 註冊／收信時給使用者的 iOS Safari 提示（無法從 Email 強制指定瀏覽器）。 */
export function iosEmailAuthSafariHint(): string | null {
  if (!iosOrIpadosLikely()) return null
  return 'iPhone 請用 Safari（或從主畫面 tsMedia 圖示）開啟信件連結；若在 Chrome 等 App 內開啟，可能無法完成驗證或重設密碼。'
}
