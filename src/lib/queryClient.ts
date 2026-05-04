import { QueryClient } from '@tanstack/react-query'

/** 與 `main.tsx` persist persister、`clearAppQueryCache` 共用 */
export const QUERY_CACHE_STORAGE_KEY = 'tsmedia-tanstack-query'

/**
 * ── PWA／前景資料策略（與 MainScreen 手動抓取並存）────────────────────────────
 *
 * 1. **全域 Refetch（TanStack Query）**
 *    `refetchOnWindowFocus` + `refetchOnReconnect` 已開啟；手機 PWA 未必會觸發 window
 *    focus，故見 `main.tsx` 用 `focusManager` + `visibilitychange`／`pageshow` 對齊。
 *
 * 2. **Session 恢復（Supabase）**
 *    GoTrue `autoRefreshToken` + `persistSession` 見 `supabase.ts`；iOS 進背景計時器暫停
 *    時不足以換發 JWT，須再呼叫 `wakeSupabaseAuthFromBackground`（同上檔；MainScreen
 *    `visibility`／`online` 已接）。
 *
 * 3. **持久化 Cache（可選）**
 *    `PersistQueryClientProvider` + `createSyncStoragePersister` 見 `main.tsx`；冷啟可先還原
 *    已快取的 `useQuery`（敏感資料請在 query `meta.persistOffline === false` 排除）。
 *    主殼探索／配對／聊天仍多以元件 state + sessionStorage 為主，與此並行。
 *
 * 登出務必 `clearAppQueryCache()`，避免下一使用者看到 dehydrated 資料。
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
      networkMode: 'online',
      retry: 2,
      staleTime: 30_000,
      /** 與 persist maxAge 對齊意念：冷啟還原後短時間內仍可命中 memory cache */
      gcTime: 86_400_000,
    },
    mutations: {
      retry: 1,
    },
  },
})

export function clearAppQueryCache(): void {
  queryClient.clear()
  try {
    localStorage.removeItem(QUERY_CACHE_STORAGE_KEY)
  } catch {
    /* private mode / quota */
  }
}
