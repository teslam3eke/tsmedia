import { supabase } from './supabase'
import {
  notifyServiceWorkerActiveChatMatch,
  notifyServiceWorkerActiveChatMatchIfForeground,
  syncActiveChatMatchToLocationUrl,
} from './swActiveChat'

const CLIENT_KEY_LS = 'tsm_push_client_key_v1'

/** 與 SW／Webhook 比對 match id 一致（去 hyphen、小寫） */
export function compactMatchId(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null
  const t = raw.trim().toLowerCase().replace(/-/g, '')
  return t.length > 0 ? t : null
}

/** 每 PWA 安裝一組；與 push_subscriptions.client_key / user_chat_presence 對齊 */
export function getPushClientKey(): string {
  if (typeof window === 'undefined') return 'ssr'
  try {
    let k = localStorage.getItem(CLIENT_KEY_LS)
    if (!k) {
      k =
        typeof crypto !== 'undefined' && 'randomUUID' in crypto
          ? crypto.randomUUID()
          : `ck-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
      localStorage.setItem(CLIENT_KEY_LS, k)
    }
    return k
  } catch {
    return `ephemeral-${Math.random().toString(36).slice(2, 12)}`
  }
}

export async function upsertUserChatPresenceOnServer(
  activeMatchId: string | null,
  visibility: 'visible' | 'hidden',
): Promise<void> {
  try {
    const { error } = await supabase.rpc('upsert_user_chat_presence', {
      p_client_key: getPushClientKey(),
      p_active_match_id: activeMatchId,
      p_visibility: visibility,
    })
    if (error) console.warn('[chatPresence] upsert', error.message)
  } catch {
    /* offline / 無 session */
  }
}

/**
 * 前景開某 match 聊天室：SW 備援 + 伺服器 presence（Webhook 主要依此略過推播）。
 */
export function armChatPresenceIfForeground(matchUuid: string | null | undefined): void {
  notifyServiceWorkerActiveChatMatchIfForeground(matchUuid)
  const visible =
    typeof document === 'undefined' || document.visibilityState === 'visible'
  const mid =
    visible && typeof matchUuid === 'string' && matchUuid.trim()
      ? matchUuid.trim().toLowerCase()
      : null
  void upsertUserChatPresenceOnServer(mid, visible ? 'visible' : 'hidden')
}

/** 離開聊天室或 App 進背景：清 SW 與伺服器 presence */
export function clearChatPresence(): void {
  notifyServiceWorkerActiveChatMatch(null)
  syncActiveChatMatchToLocationUrl(null)
  void upsertUserChatPresenceOnServer(null, 'hidden')
}
