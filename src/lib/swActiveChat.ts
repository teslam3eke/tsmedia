/**
 * 報告目前正在「線上一對一聊天室」對應的 match id。
 * SW 對相同 match 的新訊息推播將不秀 OS 橫幅（iOS 前景時 `focused` 常不可靠；多發給所有 SW registration + stagger）。
 */
export function notifyServiceWorkerActiveChatMatch(matchUuid: string | null | undefined): void {
  try {
    if (typeof navigator === 'undefined') return
    const raw = typeof matchUuid === 'string' ? matchUuid.trim() : ''
    const matchId = raw.length > 0 ? raw.toLowerCase() : null

    const msg = { type: 'TM_ACTIVE_CHAT_MATCH' as const, matchId }

    const broadcast = () => {
      try {
        navigator.serviceWorker?.controller?.postMessage(msg)
      } catch {
        /* ignore */
      }
      void navigator.serviceWorker?.getRegistrations().then((regs) => {
        for (const reg of regs) {
          try {
            reg.active?.postMessage(msg)
          } catch {
            /* ignore */
          }
        }
      })
    }

    broadcast()
    queueMicrotask(broadcast)
    globalThis.setTimeout(broadcast, 150)
    globalThis.setTimeout(broadcast, 700)
    if (!navigator.serviceWorker?.controller) {
      void navigator.serviceWorker?.ready.then(broadcast)
    }
  } catch {
    /* private mode / SW 不可用 */
  }
}
