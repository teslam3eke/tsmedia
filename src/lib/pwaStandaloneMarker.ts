/**
 * iOS：同一網域下 Safari 分頁與「加到主畫面」Web App 共用 localStorage。
 * 曾以 standalone 開過一次即設旗標；全頁重載後在瀏覽器分頁會再度經過 security-check，
 * 此時可自動繼續，毋須再按「立即封裝至主畫面」。
 */
const STORAGE_KEY = 'tm_pwa_standalone_used_v1'

function readStandaloneNow(): boolean {
  try {
    if (typeof window === 'undefined') return false
    return (
      window.matchMedia?.('(display-mode: standalone)').matches === true ||
      (window.navigator as Navigator & { standalone?: boolean }).standalone === true
    )
  } catch {
    return false
  }
}

export function markPwaStandaloneSeenIfNeeded(): void {
  try {
    if (typeof localStorage === 'undefined') return
    if (readStandaloneNow()) localStorage.setItem(STORAGE_KEY, '1')
  } catch {
    /* private mode / quota */
  }
}

export function hasUsedPwaStandaloneBefore(): boolean {
  try {
    if (typeof localStorage === 'undefined') return false
    return localStorage.getItem(STORAGE_KEY) === '1'
  } catch {
    return false
  }
}
