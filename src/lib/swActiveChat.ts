/**
 * 報告目前正在「線上一對一聊天室」對應的 match id。
 * SW 對相同 match 的新訊息推播將不秀 OS 橫幅（iOS 前景時 `focused` 常不可靠）。
 */
export function notifyServiceWorkerActiveChatMatch(matchUuid: string | null | undefined): void {
  try {
    if (typeof navigator === 'undefined') return
    const c = navigator.serviceWorker?.controller
    if (!c) return
    const trimmed = typeof matchUuid === 'string' ? matchUuid.trim().toLowerCase() : ''
    c.postMessage({
      type: 'TM_ACTIVE_CHAT_MATCH',
      matchId: trimmed.length > 0 ? trimmed : null,
    })
  } catch {
    /* private mode / SW 未控制 */
  }
}
