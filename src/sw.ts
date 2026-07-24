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

self.addEventListener('message', (event: ExtendableMessageEvent) => {
  try {
    const d = event.data as { type?: string; matchId?: string | null; count?: number } | undefined
    if (d?.type === 'TM_BADGE_SYNC' && typeof d.count === 'number') {
      event.waitUntil(syncBadgeFromClient(Math.max(0, Math.min(BADGE_MAX, Math.floor(d.count)))))
      return
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

function clampBadgeCount(n: number): number {
  return Math.max(0, Math.min(BADGE_MAX, Math.floor(n)))
}

async function writeBadgeCountCache(n: number): Promise<void> {
  cachedAppIconBadgeCount = clampBadgeCount(n)
  try {
    const cache = await caches.open(BADGE_CACHE_NAME)
    await cache.put(BADGE_CACHE_KEY, new Response(String(cachedAppIconBadgeCount)))
  } catch {
    /* ignore */
  }
}

type BadgeApiTarget = {
  setAppBadge?: (contents?: number) => Promise<void>
  clearAppBadge?: () => Promise<void>
}

/** iOS PWA：WebKit 建議 SW 用 navigator.setAppBadge；Chrome 亦可能掛在 registration */
function serviceWorkerBadgeTarget(): BadgeApiTarget | null {
  const nav = self.navigator as Navigator & BadgeApiTarget
  if ('setAppBadge' in nav) return nav
  const reg = self.registration as ServiceWorkerRegistration & BadgeApiTarget
  if ('setAppBadge' in reg) return reg
  return null
}

/** SW 內更新主畫面角標；主執行緒用 navigator.syncAppIconBadge，勿雙寫同一 context */
async function applyServiceWorkerRegistrationBadge(n: number): Promise<void> {
  const count = clampBadgeCount(n)
  const target = serviceWorkerBadgeTarget()
  if (!target?.setAppBadge) return
  try {
    if (count <= 0) await target.clearAppBadge?.()
    else await target.setAppBadge(count)
  } catch {
    /* ignore */
  }
}

/** 主執行緒 syncAppIconBadge → 對齊 cache + registration（navigator 由主執行緒負責） */
async function syncBadgeFromClient(n: number): Promise<void> {
  await applyBackgroundMessageBadge(n)
}

/** 背景推播：優先用 server 傳入的未讀總數；舊 payload 才 fallback +1 */
async function applyBackgroundMessageBadge(next: number): Promise<void> {
  const count = clampBadgeCount(next)
  await writeBadgeCountCache(count)
  await applyServiceWorkerRegistrationBadge(count)
}

async function bumpAppIconBadgeForBackgroundMessage(): Promise<void> {
  const base = await loadAppIconBadgeCountFromCache()
  await applyBackgroundMessageBadge(base + 1)
}

/** client 明確可見（不接受 undefined，避免 iOS PWA 背景被誤判為前景） */
function isClientClearlyForeground(c: WindowClient): boolean {
  return c.visibilityState === 'visible' || c.focused === true
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

self.addEventListener('push', (event: PushEvent) => {
  event.waitUntil(
    (async () => {
      let title = '新訊息'
      let body = ''
      let tag = 'tsmedia'
      let openUrl = '/'
      let payloadRefMatchId: string | null = null
      let payloadBadgeCount: number | null = null
      let payloadKind: string | null = null
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
            badgeCount?: number
          }
          if (j.title) title = j.title
          if (typeof j.body === 'string') body = j.body
          if (j.tag) tag = j.tag
          if (typeof j.kind === 'string') payloadKind = j.kind
          if (typeof j.url === 'string') openUrl = j.url
          if (typeof j.refMatchId === 'string' && j.refMatchId.trim()) {
            payloadRefMatchId = j.refMatchId.trim()
          }
          if (typeof j.matchId === 'string' && j.matchId.trim()) {
            if (!payloadRefMatchId) payloadRefMatchId = j.matchId.trim()
          }
          if (typeof j.badgeCount === 'number' && Number.isFinite(j.badgeCount)) {
            payloadBadgeCount = clampBadgeCount(j.badgeCount)
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
      const isInstantMatchPairedTag =
        tag === 'app-notif-instant_match_paired' || payloadKind === 'instant_match_paired'
      const isAppNotifTag =
        tag.startsWith('app-notif-') || (tag.includes('app-notif') && !tag.includes('discover'))
      const isMessageReceivedTag =
        tag === 'app-notif-message_received' || (tag.includes('app-notif') && tag.includes('message_received'))
      const isVerificationReviewTag =
        payloadKind === 'verification_approved' ||
        payloadKind === 'verification_rejected' ||
        tag === 'app-notif-verification_approved' ||
        tag === 'app-notif-verification_rejected'
      const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })

      /** 次要站內事件前景可靜默處理；審核結果與訊息屬關鍵通知，前景也必須顯示。 */
      if (
        !isInstantMatchPairedTag &&
        !isVerificationReviewTag &&
        isAppNotifTag &&
        !isMessageReceivedTag &&
        hasForegroundOriginClient(clients)
      ) {
        await pingClientsPushOpenQuiet(openUrl)
        return
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
      /** 僅 App 真正在背景時更新角標；server 傳 badgeCount 絕對值，避免累加漂移／重複推播 +2 */
      const shouldUpdateBackgroundBadge =
        isMessageReceivedTag && !hasForegroundOriginClient(clients)
      const badgeWork = shouldUpdateBackgroundBadge
        ? payloadBadgeCount != null
          ? applyBackgroundMessageBadge(payloadBadgeCount)
          : bumpAppIconBadgeForBackgroundMessage()
        : Promise.resolve()
      /** WebKit：push 時 showNotification 與 setAppBadge 並行（iOS 主畫面角標） */
      await Promise.all([
        self.registration.showNotification(title, o),
        badgeWork,
      ])
      if (isDiscoverDeckTag) {
        const dayKey = tag.slice('tsm-discover-deck-day-'.length)
        if (dayKey) await pingClientsDiscoverRolloverNotified(dayKey)
      }
    })(),
  )
})

/** 推播通知點擊當下刷新 fromPush／pushTs（payload 內 pushTs 為送出時間，不可用來授權） */
function normalizePushNotificationClickTarget(path: string): string {
  try {
    const u = path.startsWith('http') ? new URL(path) : new URL(path, self.location.origin)
    u.searchParams.set('fromPush', '1')
    u.searchParams.set('pushTs', String(Date.now()))
    return u.href
  } catch {
    return path.startsWith('http') ? path : new URL(path, self.location.origin).href
  }
}

self.addEventListener('notificationclick', (event: NotificationEvent) => {
  event.notification.close()
  const data = event.notification.data as { url?: string } | undefined
  const path = typeof data?.url === 'string' ? data.url : '/'
  const target = normalizePushNotificationClickTarget(path)

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
        const opened = await self.clients.openWindow(target)
        if (opened) {
          try {
            opened.postMessage({ type: 'TM_PUSH_OPEN', url: target })
          } catch {
            /* ignore */
          }
        }
      }
    })(),
  )
})
