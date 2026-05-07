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
import { checkRemoteBuildIdAndReload } from '@/lib/appVersion'
import { markPwaStandaloneSeenIfNeeded } from '@/lib/pwaStandaloneMarker'
import { ensureConnectionWithBudget, repairAuthAfterResume } from '@/lib/supabase'
import { isWithinMediaPickerGracePeriod } from '@/lib/resumeHardReload'

void maybeInitEruda()
markPwaStandaloneSeenIfNeeded()

registerSW({
  immediate: true,
  onNeedRefresh() {
    /** 選圖／上傳回前景時常觸發 SW 檢查；勿在相簿流程中強制 reload（會中斷上傳）。 */
    if (isWithinMediaPickerGracePeriod()) return
    window.location.reload()
  },
  onOfflineReady() {},
  onRegistered(r) {
    if (!import.meta.env.PROD || !r?.update) return
    /** PWA／iOS 常延遲偵測新 sw.js；前景時主動問一次 */
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') void r.update()
    })
    /** 背景長掛仍可拿到日後發佈的版本 */
    window.setInterval(() => void r.update(), 4 * 60 * 60 * 1000)
  },
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

/** 同步 TanStack；回前景先強制換發 JWT + wake（與 bounded ensure 並行）。 */
function onDocumentForegroundAlignment() {
  syncReactQueryFocusFromPageVisibility()
  if (document.visibilityState === 'visible') {
    void repairAuthAfterResume()
    void ensureConnectionWithBudget()
    void checkRemoteBuildIdAndReload()
  }
}

syncReactQueryFocusFromPageVisibility()
void checkRemoteBuildIdAndReload()
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
