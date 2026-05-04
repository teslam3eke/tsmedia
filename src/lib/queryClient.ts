import { QueryClient } from '@tanstack/react-query'

/** 與 `main.tsx` persist persister、`clearAppQueryCache` 共用 */
export const QUERY_CACHE_STORAGE_KEY = 'tsmedia-tanstack-query'

/**
 * TanStack Query 全域預設（之後遷移 `useQuery` 時會自動套用）：
 * - refetchOnWindowFocus：文件 visibility 回到 visible 時 refetch（含多數手機 PWA）
 * - refetchOnReconnect：`online` 事件
 *
 * **Persist（localStorage）**：被系統殺掉後冷啟可先還原「已快取的 queries」；容量有限、敏感資料勿進 cache。
 * 登出時務必 `clearAppQueryCache()` 以免下一位使用者看到殘留 dehydrated 資料。
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
