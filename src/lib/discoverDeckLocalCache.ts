/**
 * 探索名單 SWR：`MainScreen` DiscoverTab 將上一輪成功的 Profile 列表存於 localStorage，
 * 冷啟／回頁可先畫卡片再背景重抓 RPC。登出請與 TanStack cache 一併清掉。
 */
export const DISCOVER_DECK_LS_PREFIX = 'tsmedia-discover-deck-v3:' as const

export function discoverDeckLocalStorageKey(uid: string, dayKey: string): string {
  return `${DISCOVER_DECK_LS_PREFIX}${uid}:${dayKey}`
}

export function clearDiscoverDeckLocalCaches(): void {
  if (typeof window === 'undefined') return
  try {
    const toRemove: string[] = []
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i)
      if (k?.startsWith(DISCOVER_DECK_LS_PREFIX)) toRemove.push(k)
    }
    for (const k of toRemove) window.localStorage.removeItem(k)
  } catch {
    /* private mode / quota */
  }
}
