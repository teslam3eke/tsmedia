import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client'
import { createSyncStoragePersister } from '@tanstack/query-sync-storage-persister'
import { registerSW } from 'virtual:pwa-register'
import './index.css'
import App from './App.tsx'
import { queryClient, QUERY_CACHE_STORAGE_KEY } from '@/lib/queryClient'

registerSW({
  immediate: true,
  onNeedRefresh() {
    window.location.reload()
  },
  onOfflineReady() {},
})

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
      }}
    >
      <App />
    </PersistQueryClientProvider>
  </StrictMode>,
)
