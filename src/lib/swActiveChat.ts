/**
 * 報告目前正在「線上一對一聊天室」對應的 match id。
 * SW 對相同 match 的新訊息推播將不秀 OS 橫幅（僅在**前景**且真的開著該房時）。
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

/** 僅 App 在前景時才標記 active chat；背景／鎖屏一律清掉，避免 SW 誤擋推播。 */
export function notifyServiceWorkerActiveChatMatchIfForeground(
  matchUuid: string | null | undefined,
): void {
  if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
    notifyServiceWorkerActiveChatMatch(null)
    return
  }
  notifyServiceWorkerActiveChatMatch(matchUuid)
}
