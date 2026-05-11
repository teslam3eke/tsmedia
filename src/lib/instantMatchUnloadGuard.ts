/**
 * 整頁 `location.reload()`（hard resume、SW 更新、連線終極備案等）會觸發 `beforeunload`／`pagehide`，
 * 若此時仍呼叫 instant_match_leave_queue，使用者會被誤清等候列。呼叫端在 `reload()` 前
 * {@link markSkipInstantMatchLeaveOnNextFullUnload}；離隊邏輯用 {@link peekSkipInstantMatchLeaveOnFullUnload}／
 * {@link clearSkipInstantMatchLeaveOnFullUnload} 略過一輪。
 */
const KEY = 'tm_instant_skip_leave_on_full_unload_v1'

export function markSkipInstantMatchLeaveOnNextFullUnload(): void {
  try {
    sessionStorage.setItem(KEY, '1')
  } catch {
    /* private mode */
  }
}

export function peekSkipInstantMatchLeaveOnFullUnload(): boolean {
  try {
    return sessionStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
}

/** 在 `pagehide` 略過離隊後呼叫，避免下次真的關 App 仍被略過。 */
export function clearSkipInstantMatchLeaveOnFullUnload(): void {
  try {
    sessionStorage.removeItem(KEY)
  } catch {
    /* ignore */
  }
}
