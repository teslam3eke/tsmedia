import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { defaultShouldDehydrateQuery, focusManager, onlineManager } from '@tanstack/react-query'
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client'
import { createSyncStoragePersister } from '@tanstack/query-sync-storage-persister'
import { registerSW } from 'virtual:pwa-register'
import './index.css'
import App from './App.tsx'
import { queryClient, QUERY_CACHE_STORAGE_KEY } from '@/lib/queryClient'
import { maybeInitEruda } from '@/lib/erudaBootstrap'
import { ensureConnectionWithBudget } from '@/lib/supabase'

void maybeInitEruda()

registerSW({
  immediate: true,
  onNeedRefresh() {
    window.location.reload()
  },
  onOfflineReady() {},
})

/**
 * iOS PWA 常不觸發 window focus；同步前景／離線，讓 TanStack `refetchOnWindowFocus` /
 * `refetchOnReconnect`（見 `queryClient.ts`）與 networkMode 在手機上確實會跑。
 */
function syncReactQueryFocusFromPageVisibility() {
  const visible = document.visibilityState === 'visible'
  focusManager.setFocused(visible)
  onlineManager.setOnline(navigator.onLine)
}

/** 同步 TanStack；App 回前景時一併 bounded await ensureConnection（不依賴下游畫面監聽器）。 */
function onDocumentForegroundAlignment() {
  syncReactQueryFocusFromPageVisibility()
  if (document.visibilityState === 'visible') void ensureConnectionWithBudget()
}

syncReactQueryFocusFromPageVisibility()
document.addEventListener('visibilitychange', onDocumentForegroundAlignment)
window.addEventListener('pageshow', onDocumentForegroundAlignment)
window.addEventListener('online', () => onlineManager.setOnline(true))
window.addEventListener('offline', () => onlineManager.setOnline(false))

const queryPersister = createSyncStoragePersister({
  storage: window.localStorage,
  key: QUERY_CACHE_STORAGE_KEY,
  throttleTime: 3000,
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{
        persister: queryPersister,
        maxAge: 86_400_000,
        buster: __APP_BUILD_ID__,
        dehydrateOptions: {
          /** 預設會 dehydrate；敏感資料請 `meta: { persistOffline: false }` 排除 */
          shouldDehydrateQuery: (query) =>
            defaultShouldDehydrateQuery(query) &&
            (query.meta as { persistOffline?: boolean } | undefined)?.persistOffline !== false,
        },
      }}
    >
      <App />
    </PersistQueryClientProvider>
  </StrictMode>,
)
