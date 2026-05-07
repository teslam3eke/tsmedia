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
  let title = 'tsMedia'
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
  const o: NotificationOptions & { renotify?: boolean } = {
    body: body || undefined,
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    tag,
    data: { url: openUrl },
    renotify: true,
  }
  event.waitUntil(self.registration.showNotification(title, o))
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
        if (c instanceof WindowClient && c.url.startsWith(self.location.origin)) {
          await c.focus()
          return
        }
      }
      await self.clients.openWindow(target)
    })(),
  )
})
