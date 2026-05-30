/** 推播／通知點擊後的站內導航意圖（與 `?tab=` / `?match=` / `?notif=` 對齊） */
export type PushDeepLinkTab = 'discover' | 'matches' | 'instant' | 'profile'

export type PushDeepLinkIntent = {
  tab?: PushDeepLinkTab
  matchId?: string
  notifId?: string
}

const PENDING_PUSH_DEEP_LINK_KEY = 'tm_pending_push_deep_link_v1'

const TAB_VALUES = new Set<PushDeepLinkTab>(['discover', 'matches', 'instant', 'profile'])

export function parsePushDeepLinkFromSearchParams(params: URLSearchParams): PushDeepLinkIntent | null {
  const tabParam = params.get('tab')
  const notifRaw = params.get('notif')
  const matchRaw = params.get('match')
  if (!tabParam && !notifRaw && !matchRaw) return null

  const intent: PushDeepLinkIntent = {}
  if (tabParam === 'messages') intent.tab = 'matches'
  else if (tabParam && TAB_VALUES.has(tabParam as PushDeepLinkTab)) {
    intent.tab = tabParam as PushDeepLinkTab
  }

  const matchId = typeof matchRaw === 'string' ? matchRaw.trim().toLowerCase() : ''
  if (matchId) intent.matchId = matchId

  const notifId = typeof notifRaw === 'string' ? notifRaw.trim() : ''
  if (notifId) intent.notifId = notifId

  if (!intent.tab && !intent.matchId && !intent.notifId) return null
  return intent
}

export function mergePushDeepLinkIntent(
  a: PushDeepLinkIntent | null,
  b: PushDeepLinkIntent | null,
): PushDeepLinkIntent | null {
  if (!a && !b) return null
  return {
    tab: b?.tab ?? a?.tab,
    matchId: b?.matchId ?? a?.matchId,
    notifId: b?.notifId ?? a?.notifId,
  }
}

export function pushDeepLinkIntentFromAppNotification(payload: {
  id: string
  kind: string
  url?: string
  ref_match_id?: string | null
}): PushDeepLinkIntent {
  if (typeof payload.url === 'string' && payload.url.trim()) {
    try {
      const u = new URL(payload.url, 'https://local.invalid')
      const fromUrl = parsePushDeepLinkFromSearchParams(u.searchParams)
      if (fromUrl) {
        return mergePushDeepLinkIntent(fromUrl, { notifId: payload.id }) ?? { notifId: payload.id }
      }
    } catch {
      /* fall through */
    }
  }

  const intent: PushDeepLinkIntent = { notifId: payload.id }
  const ref =
    typeof payload.ref_match_id === 'string' && payload.ref_match_id.trim()
      ? payload.ref_match_id.trim().toLowerCase()
      : ''
  if (ref) intent.matchId = ref

  switch (payload.kind) {
    case 'message_received':
      intent.tab = 'matches'
      break
    case 'super_like_received':
      intent.tab = 'discover'
      break
    case 'match_created':
      intent.tab = 'matches'
      break
    case 'verification_approved':
    case 'verification_rejected':
      intent.tab = 'profile'
      break
  }
  return intent
}

export function intentToPushOpenUrl(intent: PushDeepLinkIntent): string {
  const p = new URLSearchParams()
  if (intent.notifId) p.set('notif', intent.notifId)
  if (intent.matchId) p.set('match', intent.matchId)
  if (intent.tab) p.set('tab', intent.tab)
  p.set('fromPush', '1')
  const qs = p.toString()
  return qs ? `/?${qs}` : '/?fromPush=1'
}

export function persistPendingPushDeepLink(intent: PushDeepLinkIntent): void {
  try {
    sessionStorage.setItem(PENDING_PUSH_DEEP_LINK_KEY, JSON.stringify(intent))
  } catch {
    /* private mode */
  }
}

export function readPendingPushDeepLink(): PushDeepLinkIntent | null {
  try {
    const raw = sessionStorage.getItem(PENDING_PUSH_DEEP_LINK_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as PushDeepLinkIntent
    if (!parsed || typeof parsed !== 'object') return null
    return parsed
  } catch {
    return null
  }
}

export function clearPendingPushDeepLink(): void {
  try {
    sessionStorage.removeItem(PENDING_PUSH_DEEP_LINK_KEY)
  } catch {
    /* private mode */
  }
}

/** 從網址移除推播 deep link 參數，避免重複消費或分享出去帶參數 */
export function stripPushDeepLinkParamsFromUrl(): void {
  if (typeof window === 'undefined') return
  const url = new URL(window.location.href)
  const had =
    url.searchParams.has('tab') ||
    url.searchParams.has('notif') ||
    url.searchParams.has('match') ||
    url.searchParams.has('fromPush')
  if (!had) return
  url.searchParams.delete('fromPush')
  url.searchParams.delete('notif')
  url.searchParams.delete('match')
  url.searchParams.delete('tab')
  const rest = url.searchParams.toString()
  window.history.replaceState({}, '', url.pathname + (rest ? `?${rest}` : ''))
}

/** 探索換日推播／站內通知點擊後導向探索分頁 */
export function discoverDeckPushOpenUrl(): string {
  return '/?tab=discover&fromPush=1'
}

export type ApplyPushDeepLinkOutcome = 'applied' | 'blocked_instant' | 'deferred_no_user'
