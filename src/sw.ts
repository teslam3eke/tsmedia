/// <reference lib="webworker" />
import { precacheAndRoute } from 'workbox-precaching'
import { registerRoute } from 'workbox-routing'
import { NetworkOnly } from 'workbox-strategies'

declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: string | string[] }

precacheAndRoute(self.__WB_MANIFEST)

registerRoute(({ url }) => url.pathname === '/api/git-sha' || url.pathname.endsWith('/api/git-sha'), new NetworkOnly())
registerRoute(
  ({ url }) => url.pathname === '/build-id.txt' || url.pathname.endsWith('/build-id.txt'),
  new NetworkOnly(),
)
registerRoute(({ url }) => url.hostname.endsWith('.supabase.co'), new NetworkOnly())

self.addEventListener('install', () => {
  /** skipWaiting：與 vite PWA clientsClaim 對齊 */
  void self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener('push', (event: PushEvent) => {
  event.waitUntil(
    (async () => {
      let title = '新訊息'
      let body = ''
      let tag = 'tsmedia'
      let openUrl = '/'
      try {
        if (event.data) {
          const j = event.data.json() as { title?: string; body?: string; tag?: string; url?: string }
          if (j.title) title = j.title
          if (typeof j.body === 'string') body = j.body
          if (j.tag) tag = j.tag
          if (typeof j.url === 'string') openUrl = j.url
        }
      } catch {
        try {
          const t = event.data?.text()
          if (t) body = t
        } catch {
          /* ignore */
        }
      }

      /** 與 LINE 類似：App 已在前景且視窗有焦點時，新訊息不彈系統橫幅（站內改用即時聊天／角標） */
      const isMessageReceivedTag = tag === 'app-notif-message_received'
      if (isMessageReceivedTag) {
        const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
        const focusedHere = clients.some(
          (x) =>
            x instanceof WindowClient &&
            x.focused === true &&
            typeof x.url === 'string' &&
            x.url.startsWith(self.location.origin),
        )
        if (focusedHere) {
          for (const x of clients) {
            if (!(x instanceof WindowClient)) continue
            if (!x.url.startsWith(self.location.origin)) continue
            try {
              x.postMessage({ type: 'TM_PUSH_MESSAGE_RECEIVED_FOREGROUND' })
            } catch {
              /* ignore */
            }
          }
          return
        }
      }

      const o: NotificationOptions & { renotify?: boolean } = {
        body: body || undefined,
        icon: '/icons/icon-192.png',
        badge: '/icons/icon-192.png',
        tag,
        data: { url: openUrl },
        renotify: true,
      }
      await self.registration.showNotification(title, o)
    })(),
  )
})

self.addEventListener('notificationclick', (event: NotificationEvent) => {
  event.notification.close()
  const data = event.notification.data as { url?: string } | undefined
  const path = typeof data?.url === 'string' ? data.url : '/'
  const target = path.startsWith('http') ? path : new URL(path, self.location.origin).href

  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      for (const c of all) {
        if (!(c instanceof WindowClient)) continue
        if (!c.url.startsWith(self.location.origin)) continue
        const w = c as WindowClient & { navigate?: (u: string) => Promise<WindowClient | null> }
        if (typeof w.navigate === 'function') {
          try {
            await w.navigate(target)
            await c.focus()
            return
          } catch {
            /* 部分 WebKit 不實作或拒絕 navigate */
          }
        }
        await c.focus()
        try {
          c.postMessage({ type: 'TM_NAVIGATE', url: target })
        } catch {
          /* ignore */
        }
        return
      }
      await self.clients.openWindow(target)
    })(),
  )
})
