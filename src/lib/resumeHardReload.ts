/**
 * 主殼回前景後整頁重載（類冷啟）：可用 `?noHardResume=1` 永久關閉（sessionStorage）。
 * `?clearNoHardResume=1` 會清掉該關閉旗標（曾測試關過又忘記時很常發生）。
 * `?debugHardResume=1` 會在 console 印 `[hardResume]`（需在 Mac Safari 接上裝置除錯）。
 */

const STORAGE_DISABLE_KEY = 'tm_no_hard_resume'

/** Android / desktop PWA：`display-mode: standalone`。iOS 加到主畫面：`navigator.standalone`。 */
export function standaloneDisplayModeLikely(): boolean {
  try {
    if (typeof window === 'undefined' || typeof navigator === 'undefined') return false
    if (window.matchMedia?.('(display-mode: standalone)').matches) return true
    return (navigator as Navigator & { standalone?: boolean }).standalone === true
  } catch {
    return false
  }
}

/**
 * Safari 網址列分頁並非 standalone，`navigator.standalone` 為假，但回前景凍結／fetch 中止與 PWA 同源。
 * blur／focus 監聽須涵蓋此情況（否則只靠 visibility 易漏、整頁 reload 也不觸發）。
 */
export function iosOrIpadosLikely(): boolean {
  try {
    if (typeof navigator === 'undefined') return false
    const ua = navigator.userAgent || ''
    if (/iPhone|iPod|iPad/i.test(ua)) return true
    return navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1
  } catch {
    return false
  }
}

export function windowBlurWakeLikelyForResumeReload(): boolean {
  return standaloneDisplayModeLikely() || iosOrIpadosLikely()
}

/**
 * 是否註冊「主殼回前景整頁重載」監聽。一般桌機瀏覽器分頁僅用 visibility 就會在切換分頁時誤觸重載；
 * 僅在 PWA standalone、iOS／iPadOS、或 Android 手機瀏覽器啟用（與 blur／focus 補洞範圍對齊並略含 Android Chrome）。
 */
export function resumeHardReloadEnabled(): boolean {
  if (standaloneDisplayModeLikely()) return true
  if (iosOrIpadosLikely()) return true
  try {
    const ua = navigator.userAgent || ''
    if (/Android/i.test(ua) && /Mobile/i.test(ua)) return true
  } catch {
    /* ignore */
  }
  return false
}

export function resumeHardReloadDisabledGlobally(): boolean {
  try {
    const q = new URLSearchParams(window.location.search)
    if (q.get('clearNoHardResume') === '1') sessionStorage.removeItem(STORAGE_DISABLE_KEY)
    if (q.get('noHardResume') === '1') sessionStorage.setItem(STORAGE_DISABLE_KEY, '1')
    return sessionStorage.getItem(STORAGE_DISABLE_KEY) === '1'
  } catch {
    return false
  }
}

/** 選相簿／拍攝會讓 PWA blur 很久，`resume` hard reload 若觸發會中斷上傳。 */
const MEDIA_PICKER_GRACE_KEY = 'tm_media_picker_grace_until'

export function touchMediaPickerGraceSession(): void {
  try {
    /** 數分鐘內略過自動整頁重載／ensure 終極 reload */
    sessionStorage.setItem(MEDIA_PICKER_GRACE_KEY, String(Date.now() + 240_000))
  } catch {
    /* private mode */
  }
}

/**
 * 若用 button `onClick` 再程式呼叫 `input.click()`，使用者的 pointer 目標不是 file input，
 * 僅監聽 `input[type=file]` 的 grace 永遠不會觸發。一律由此開啟相簿／檔案選擇器。
 */
export function clickFileInputWithGrace(input: HTMLInputElement | null | undefined): void {
  touchMediaPickerGraceSession()
  input?.click()
}

export function isWithinMediaPickerGracePeriod(): boolean {
  try {
    const v = sessionStorage.getItem(MEDIA_PICKER_GRACE_KEY)
    if (!v) return false
    const until = Number.parseInt(v, 10)
    if (!Number.isFinite(until)) return false
    return Date.now() < until
  } catch {
    return false
  }
}
