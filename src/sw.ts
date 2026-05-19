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

/** 與 URL / JSON 可能帶 hyphen 的 uuid 對齊：比對時一律 compact 小寫 hex */
function normalizeMatchIdForCompare(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null
  const t = raw.trim().toLowerCase()
  if (!t) return null
  const compact = t.replace(/-/g, '')
  return compact.length > 0 ? compact : null
}

self.addEventListener('message', (event: ExtendableMessageEvent) => {
  try {
    const d = event.data as { type?: string; matchId?: string | null } | undefined
    if (d?.type !== 'TM_ACTIVE_CHAT_MATCH') return
    activeChatMatchIdLc = normalizeMatchIdForCompare(d.matchId)
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
    return normalizeMatchIdForCompare(raw)
  } catch {
    return null
  }
}

/** 前景聊天室備援：`?tm_chat=`（主執行緒 replaceState）或推播 deep link 的 `?match=` */
function matchIdFromClientUrl(clientUrl: string): string | null {
  try {
    const u = new URL(clientUrl)
    if (u.origin !== self.location.origin) return null
    const raw = u.searchParams.get('tm_chat') ?? u.searchParams.get('match')
    if (!raw?.trim()) return null
    return normalizeMatchIdForCompare(raw)
  } catch {
    return null
  }
}

function shouldSuppressMessagePushForMatch(
  incomingMatchLc: string,
  clients: readonly Client[],
): boolean {
  const originClients = clients.filter(
    (x): x is WindowClient =>
      x instanceof WindowClient &&
      typeof x.url === 'string' &&
      x.url.startsWith(self.location.origin),
  )
  if (originClients.length === 0) return false

  /** iOS：postMessage 常漏，以 clients.url 的 tm_chat 為準 */
  if (originClients.some((c) => matchIdFromClientUrl(c.url) === incomingMatchLc)) {
    return true
  }

  /** postMessage 有 arm 時：前景／focused 即抑制（visibilityState 在 iOS 常失準） */
  if (activeChatMatchIdLc === incomingMatchLc) {
    return originClients.some(
      (c) => c.visibilityState === 'visible' || c.focused === true || c.visibilityState === undefined,
    )
  }

  return false
}

async function pingClientsForegroundAppNotifQuiet(): Promise<void> {
  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
  for (const x of clients) {
    if (!(x instanceof WindowClient)) continue
    if (!x.url.startsWith(self.location.origin)) continue
    try {
      x.postMessage({ type: 'TM_PUSH_APP_NOTIF_FOREGROUND' })
    } catch {
      /* ignore */
    }
  }
}

function hasForegroundOriginClient(clients: readonly Client[]): boolean {
  return clients.some(
    (x) =>
      x instanceof WindowClient &&
      typeof x.url === 'string' &&
      x.url.startsWith(self.location.origin) &&
      (x.visibilityState === 'visible' || x.focused === true || x.visibilityState === undefined),
  )
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
            payloadMatchLc = normalizeMatchIdForCompare(j.matchId)
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

      const isAppNotifTag =
        tag.startsWith('app-notif-') || (tag.includes('app-notif') && !tag.includes('discover'))
      const isMessageReceivedTag =
        tag === 'app-notif-message_received' || (tag.includes('app-notif') && tag.includes('message_received'))
      const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })

      /** PWA 前景：站內彈窗即可，不秀 OS 橫幅（驗證通過／拒絕等） */
      if (isAppNotifTag && !isMessageReceivedTag && hasForegroundOriginClient(clients)) {
        await pingClientsForegroundAppNotifQuiet()
        return
      }

      if (isMessageReceivedTag) {
        const incomingMatchLc = payloadMatchLc ?? matchIdFromPayloadUrl(openUrl)

        if (incomingMatchLc != null && shouldSuppressMessagePushForMatch(incomingMatchLc, clients)) {
          await pingClientsForegroundMessageQuiet()
          return
        }

        /** 舊 payload 無 match：僅在前景 focused 時略過（站內靠列表／角標） */
        const focusedVisibleHere = clients.some(
          (x) =>
            x instanceof WindowClient &&
            x.focused === true &&
            typeof x.url === 'string' &&
            x.url.startsWith(self.location.origin),
        )
        if (focusedVisibleHere && incomingMatchLc == null) {
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
