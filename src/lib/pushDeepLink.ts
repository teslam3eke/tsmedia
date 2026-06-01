/** 推播／通知點擊後的站內導航意圖（與 `?tab=` / `?match=` / `?notif=` 對齊） */
import { TM_ACTIVE_CHAT_URL_PARAM } from '@/lib/swActiveChat'

export type PushDeepLinkTab = 'discover' | 'matches' | 'instant' | 'profile'

export type PushDeepLinkIntent = {
  tab?: PushDeepLinkTab
  matchId?: string
  notifId?: string
}

const PENDING_PUSH_DEEP_LINK_KEY = 'tm_pending_push_deep_link_v1'
const PUSH_LAUNCH_TOKEN_KEY = 'tm_push_launch_token_v1'
export const PUSH_TS_URL_PARAM = 'pushTs'
/** 推播點擊後允許消費 deep link 的時間窗（主畫面圖示開啟不應帶有效 pushTs） */
export const PUSH_LAUNCH_MAX_AGE_MS = 120_000

const TAB_VALUES = new Set<PushDeepLinkTab>(['discover', 'matches', 'instant', 'profile'])

export function appendPushLaunchParams(p: URLSearchParams): void {
  p.set('fromPush', '1')
  p.set(PUSH_TS_URL_PARAM, String(Date.now()))
}

export function markPushNotificationLaunchToken(): void {
  try {
    sessionStorage.setItem(PUSH_LAUNCH_TOKEN_KEY, String(Date.now()))
  } catch {
    /* private mode */
  }
}

/** SW postMessage 點推播時標記；與 consume 成對，避免重複消費 */
export function consumePushNotificationLaunchToken(maxAgeMs = PUSH_LAUNCH_MAX_AGE_MS): boolean {
  try {
    const raw = sessionStorage.getItem(PUSH_LAUNCH_TOKEN_KEY)
    sessionStorage.removeItem(PUSH_LAUNCH_TOKEN_KEY)
    if (!raw) return false
    const ts = parseInt(raw, 10)
    return Number.isFinite(ts) && Date.now() - ts <= maxAgeMs
  } catch {
    return false
  }
}

export function isFreshPushLaunchUrl(params: URLSearchParams, maxAgeMs = PUSH_LAUNCH_MAX_AGE_MS): boolean {
  if (params.get('fromPush') !== '1') return false
  const ts = parseInt(params.get(PUSH_TS_URL_PARAM) ?? '', 10)
  if (!Number.isFinite(ts)) return false
  return Date.now() - ts <= maxAgeMs
}

/** 僅推播點擊（新 pushTs 或 SW 剛標 token）才允許開聊天室 */
export function authorizePushDeepLinkConsumption(params: URLSearchParams): boolean {
  if (isFreshPushLaunchUrl(params)) return true
  try {
    const raw = sessionStorage.getItem(PUSH_LAUNCH_TOKEN_KEY)
    if (!raw) return false
    const ts = parseInt(raw, 10)
    return Number.isFinite(ts) && Date.now() - ts <= PUSH_LAUNCH_MAX_AGE_MS
  } catch {
    return false
  }
}

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
  appendPushLaunchParams(p)
  return `/?${p.toString()}`
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

const SHELL_LAUNCH_STRIP_PARAMS = ['fromPush', PUSH_TS_URL_PARAM, 'notif', 'match', 'tab', TM_ACTIVE_CHAT_URL_PARAM] as const

/** 主畫面圖示／一般開啟：清掉殘留 deep link 與 tm_chat，避免誤進聊天室 */
export function resetShellUrlForHomeIconLaunch(): void {
  if (typeof window === 'undefined') return
  const url = new URL(window.location.href)
  let changed = false
  for (const key of SHELL_LAUNCH_STRIP_PARAMS) {
    if (url.searchParams.has(key)) {
      url.searchParams.delete(key)
      changed = true
    }
  }
  if (!changed) return
  const rest = url.searchParams.toString()
  window.history.replaceState({}, '', url.pathname + (rest ? `?${rest}` : ''))
}

/** 推播 deep link 消費後：移除導航參數，避免重複開啟 */
export function stripPushDeepLinkParamsFromUrl(): void {
  if (typeof window === 'undefined') return
  const url = new URL(window.location.href)
  const had = SHELL_LAUNCH_STRIP_PARAMS.some((key) => url.searchParams.has(key))
  if (!had) return
  for (const key of SHELL_LAUNCH_STRIP_PARAMS) url.searchParams.delete(key)
  const rest = url.searchParams.toString()
  window.history.replaceState({}, '', url.pathname + (rest ? `?${rest}` : ''))
}

/** 探索換日推播／站內通知點擊後導向探索分頁 */
export function discoverDeckPushOpenUrl(): string {
  const p = new URLSearchParams()
  p.set('tab', 'discover')
  appendPushLaunchParams(p)
  return `/?${p.toString()}`
}

export type ApplyPushDeepLinkOutcome = 'applied' | 'blocked_instant' | 'deferred_no_user'
