/** 與 SW `matchIdFromClientUrl` 對齊：推播抑制備援（iOS postMessage 常漏） */
export const TM_ACTIVE_CHAT_URL_PARAM = 'tm_chat'

function normalizeMatchIdForUrl(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null
  const t = raw.trim().toLowerCase()
  return t.length > 0 ? t : null
}

/** 前景開著某配對聊天室時寫入網址列，供 SW 在 push 當下讀取 clients.url */
export function syncActiveChatMatchToLocationUrl(matchUuid: string | null | undefined): void {
  if (typeof window === 'undefined') return
  try {
    const url = new URL(window.location.href)
    const prev = url.searchParams.get(TM_ACTIVE_CHAT_URL_PARAM)
    const next = normalizeMatchIdForUrl(matchUuid)
    if ((prev ?? '') === (next ?? '')) return
    if (next) url.searchParams.set(TM_ACTIVE_CHAT_URL_PARAM, next)
    else url.searchParams.delete(TM_ACTIVE_CHAT_URL_PARAM)
    const qs = url.searchParams.toString()
    window.history.replaceState(window.history.state, '', url.pathname + (qs ? `?${qs}` : '') + url.hash)
  } catch {
    /* ignore */
  }
}

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
    syncActiveChatMatchToLocationUrl(null)
    return
  }
  notifyServiceWorkerActiveChatMatch(matchUuid)
  syncActiveChatMatchToLocationUrl(matchUuid)
}
