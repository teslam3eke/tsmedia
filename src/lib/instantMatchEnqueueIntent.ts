/**
 * 整頁 reload 後 React 的「排隊中」狀態會消失；053 下 remount 首輪 enqueue:false 會清等候列。
 * 排隊中寫入 sessionStorage，remount 時還原 assumeEnqueuePollIntent。
 */
const KEY = 'tm_instant_enqueue_intent_v1'

export function persistInstantEnqueueIntent(userId: string): void {
  if (!userId) return
  try {
    sessionStorage.setItem(KEY, userId)
  } catch {
    /* private mode */
  }
}

export function readInstantEnqueueIntent(userId: string | null | undefined): boolean {
  if (!userId) return false
  try {
    return sessionStorage.getItem(KEY) === userId
  } catch {
    return false
  }
}

export function clearInstantEnqueueIntent(userId: string | null | undefined): void {
  if (!userId) return
  try {
    if (sessionStorage.getItem(KEY) === userId) {
      sessionStorage.removeItem(KEY)
    }
  } catch {
    /* ignore */
  }
}
