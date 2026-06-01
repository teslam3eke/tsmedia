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
  event.waitUntil(
    Promise.all([
      self.clients.claim(),
      loadAppIconBadgeCountFromCache().then((n) => {
        cachedAppIconBadgeCount = n
      }),
    ]),
  )
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
    const d = event.data as { type?: string; matchId?: string | null; count?: number } | undefined
    if (d?.type === 'TM_ACTIVE_CHAT_MATCH') {
      activeChatMatchIdLc = normalizeMatchIdForCompare(d.matchId)
      return
    }
    if (d?.type === 'TM_BADGE_SYNC' && typeof d.count === 'number') {
      void persistAppIconBadgeCount(Math.max(0, Math.min(99, Math.floor(d.count))))
    }
  } catch {
    /* ignore */
  }
})

const BADGE_CACHE_NAME = 'tm-app-badge-v1'
const BADGE_CACHE_KEY = '/badge-count'
const BADGE_MAX = 99
let cachedAppIconBadgeCount = 0

async function loadAppIconBadgeCountFromCache(): Promise<number> {
  try {
    const cache = await caches.open(BADGE_CACHE_NAME)
    const res = await cache.match(BADGE_CACHE_KEY)
    if (!res) return cachedAppIconBadgeCount
    const t = await res.text()
    const n = parseInt(t, 10)
    return Number.isFinite(n) ? Math.max(0, Math.min(BADGE_MAX, n)) : 0
  } catch {
    return cachedAppIconBadgeCount
  }
}

async function persistAppIconBadgeCount(n: number): Promise<void> {
  cachedAppIconBadgeCount = Math.max(0, Math.min(BADGE_MAX, Math.floor(n)))
  try {
    const cache = await caches.open(BADGE_CACHE_NAME)
    await cache.put(BADGE_CACHE_KEY, new Response(String(cachedAppIconBadgeCount)))
  } catch {
    /* ignore */
  }
  try {
    const reg = self.registration as ServiceWorkerRegistration & {
      setAppBadge?: (contents?: number) => Promise<void>
      clearAppBadge?: () => Promise<void>
    }
    if (!('setAppBadge' in reg)) return
    if (cachedAppIconBadgeCount <= 0) await reg.clearAppBadge!()
    else await reg.setAppBadge!(cachedAppIconBadgeCount)
  } catch {
    /* ignore */
  }
}

/** App 未開／背景收到訊息推播且將秀 OS 橫幅時，角標 +1（開 App 後由主程式以 DB 總數覆寫） */
async function bumpAppIconBadgeForBackgroundMessage(): Promise<void> {
  const base = await loadAppIconBadgeCountFromCache()
  await persistAppIconBadgeCount(base + 1)
}

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

/** client 明確可見（不接受 undefined，避免 iOS PWA 背景被誤判為前景） */
function isClientClearlyForeground(c: WindowClient): boolean {
  return c.visibilityState === 'visible' || c.focused === true
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

  /**
   * iOS：postMessage 常漏，以 clients.url 的 ?tm_chat= 為備援。
   * 但必須同時確認 client 明確在前景（visible/focused），
   * 否則背景 URL 殘留會讓推播橫幅被吃掉。
   */
  if (
    originClients.some(
      (c) => matchIdFromClientUrl(c.url) === incomingMatchLc && isClientClearlyForeground(c),
    )
  ) {
    return true
  }

  /**
   * postMessage 有 arm 時：僅在 client 明確前景才抑制。
   * 移除 visibilityState === undefined，避免 iOS PWA 背景狀態未知時誤擋橫幅。
   */
  if (activeChatMatchIdLc === incomingMatchLc) {
    return originClients.some(isClientClearlyForeground)
  }

  return false
}

async function pingClientsPushOpenQuiet(openUrl: string): Promise<void> {
  const target = openUrl.startsWith('http')
    ? openUrl
    : new URL(openUrl, self.location.origin).href
  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
  let focused = false
  for (const x of clients) {
    if (!(x instanceof WindowClient)) continue
    if (!x.url.startsWith(self.location.origin)) continue
    if (!focused) {
      try {
        await x.focus()
      } catch {
        /* ignore */
      }
      focused = true
      /** iOS PWA：navigate 寫入 URL 作為 postMessage 漏送時的備援 */
      try {
        if (typeof x.navigate === 'function') {
          await x.navigate(target)
        }
      } catch {
        /* ignore */
      }
    }
    try {
      x.postMessage({ type: 'TM_PUSH_OPEN', url: target })
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
      isClientClearlyForeground(x),
  )
}

async function pingClientsDiscoverRolloverNotified(dayKey: string): Promise<void> {
  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
  for (const x of clients) {
    if (!(x instanceof WindowClient)) continue
    if (!x.url.startsWith(self.location.origin)) continue
    try {
      x.postMessage({ type: 'TM_DISCOVER_ROLLOVER_NOTIFIED', dayKey })
    } catch {
      /* ignore */
    }
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
      let payloadRefMatchId: string | null = null
      try {
        if (event.data) {
          const j = event.data.json() as {
            title?: string
            body?: string
            tag?: string
            url?: string
            matchId?: string
            refMatchId?: string
            kind?: string
            notifId?: string
          }
          if (j.title) title = j.title
          if (typeof j.body === 'string') body = j.body
          if (j.tag) tag = j.tag
          if (typeof j.url === 'string') openUrl = j.url
          if (typeof j.refMatchId === 'string' && j.refMatchId.trim()) {
            payloadRefMatchId = j.refMatchId.trim()
          }
          if (typeof j.matchId === 'string' && j.matchId.trim()) {
            payloadMatchLc = normalizeMatchIdForCompare(j.matchId)
            if (!payloadRefMatchId) payloadRefMatchId = j.matchId.trim()
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

      const isDiscoverDeckTag = tag.startsWith('tsm-discover-deck-day-')
      const isAppNotifTag =
        tag.startsWith('app-notif-') || (tag.includes('app-notif') && !tag.includes('discover'))
      const isMessageReceivedTag =
        tag === 'app-notif-message_received' || (tag.includes('app-notif') && tag.includes('message_received'))
      const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })

      /** 站內事件（驗證／超喜等）：前景不秀 OS 橫幅，改與背景點擊相同的 deep link 路徑 */
      if (isAppNotifTag && !isMessageReceivedTag && hasForegroundOriginClient(clients)) {
        await pingClientsPushOpenQuiet(openUrl)
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

        /** 背景推播：先累加角標再 showNotification（iOS PWA Badging API） */
        await bumpAppIconBadgeForBackgroundMessage()
      }

      /** 10 點探索換日：不論前景背景一律 showNotification（若同 tag 已由準點本地通知顯示則略過） */
      if (isDiscoverDeckTag) {
        const existing = await self.registration.getNotifications({ tag })
        if (existing.length > 0) {
          const dayKey = tag.slice('tsm-discover-deck-day-'.length)
          if (dayKey) await pingClientsDiscoverRolloverNotified(dayKey)
          return
        }
      }

      const o: NotificationOptions & { renotify?: boolean } = {
        body: body || undefined,
        icon: '/icons/icon-192.png',
        badge: '/icons/icon-192.png',
        tag,
        data: { url: openUrl },
        /** 換日 tag 固定；renotify 會在 Cron + 前景各 show 一次時連跳兩則 */
        renotify: !isDiscoverDeckTag,
      }
      await self.registration.showNotification(title, o)
      if (isDiscoverDeckTag) {
        const dayKey = tag.slice('tsm-discover-deck-day-'.length)
        if (dayKey) await pingClientsDiscoverRolloverNotified(dayKey)
      }
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
      let focused = false
      for (const c of all) {
        if (!(c instanceof WindowClient)) continue
        if (!c.url.startsWith(self.location.origin)) continue
        if (!focused) {
          try {
            await c.focus()
          } catch {
            /* ignore */
          }
          focused = true
          try {
            if (typeof c.navigate === 'function') {
              await c.navigate(target)
            }
          } catch {
            /* ignore */
          }
        }
        try {
          c.postMessage({ type: 'TM_PUSH_OPEN', url: target })
        } catch {
          /* ignore */
        }
      }
      if (!focused) {
        await self.clients.openWindow(target)
      }
    })(),
  )
})
