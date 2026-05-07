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

/** 主執行緒回報：使用者正待在與該 match 的一對一聊；此 match 的新訊息不顯示推播橫幅 */
let activeChatMatchIdLc: string | null = null

self.addEventListener('message', (event: ExtendableMessageEvent) => {
  try {
    const d = event.data as { type?: string; matchId?: string | null } | undefined
    if (d?.type !== 'TM_ACTIVE_CHAT_MATCH') return
    activeChatMatchIdLc =
      typeof d.matchId === 'string' && d.matchId.trim().length > 0 ? d.matchId.trim().toLowerCase() : null
  } catch {
    /* ignore */
  }
})

function matchIdFromPayloadUrl(openUrlPath: string): string | null {
  try {
    const u = openUrlPath.startsWith('http')
      ? new URL(openUrlPath)
      : new URL(openUrlPath, self.location.origin)
    const raw = u.searchParams.get('match')
    if (!raw || !raw.trim()) return null
    return raw.trim().toLowerCase()
  } catch {
    return null
  }
}

async function pingClientsForegroundMessageQuiet(): Promise<void> {
  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
  for (const x of clients) {
    if (!(x instanceof WindowClient)) continue
    if (!x.url.startsWith(self.location.origin)) continue
    try {
      x.postMessage({ type: 'TM_PUSH_MESSAGE_RECEIVED_FOREGROUND' })
    } catch {
      /* ignore */
    }
  }
}

self.addEventListener('push', (event: PushEvent) => {
  event.waitUntil(
    (async () => {
      let title = '新訊息'
      let body = ''
      let tag = 'tsmedia'
      let openUrl = '/'
      let payloadMatchLc: string | null = null
      try {
        if (event.data) {
          const j = event.data.json() as {
            title?: string
            body?: string
            tag?: string
            url?: string
            matchId?: string
          }
          if (j.title) title = j.title
          if (typeof j.body === 'string') body = j.body
          if (j.tag) tag = j.tag
          if (typeof j.url === 'string') openUrl = j.url
          if (typeof j.matchId === 'string' && j.matchId.trim()) {
            payloadMatchLc = j.matchId.trim().toLowerCase()
          }
        }
      } catch {
        try {
          const t = event.data?.text()
          if (t) body = t
        } catch {
          /* ignore */
        }
      }

      /** 與 LINE 類似：同 chat match id／或多數瀏覽器 `visibilityState:visible` 時不橫幅（補齊 `focused` 在 iOS 失準） */
      const isMessageReceivedTag = tag === 'app-notif-message_received'
      if (isMessageReceivedTag) {
        const incomingMatchLc = payloadMatchLc ?? matchIdFromPayloadUrl(openUrl)
        const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })

        if (
          incomingMatchLc != null &&
          activeChatMatchIdLc != null &&
          incomingMatchLc === activeChatMatchIdLc
        ) {
          await pingClientsForegroundMessageQuiet()
          return
        }

        const focusedHere = clients.some(
          (x) =>
            x instanceof WindowClient &&
            x.focused === true &&
            typeof x.url === 'string' &&
            x.url.startsWith(self.location.origin),
        )
        /** 舊 payload 無 match：`focused` 時仍不強打橫幅（站内靠列表／角標） */
        if (focusedHere && incomingMatchLc == null) {
          await pingClientsForegroundMessageQuiet()
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
        await c.focus()
        try {
          c.postMessage({ type: 'TM_PUSH_OPEN', url: target })
        } catch {
          /* ignore */
        }
        return
      }
      await self.clients.openWindow(target)
    })(),
  )
})
