import { useEffect } from 'react'
import { supabase } from './supabase'
import { getPushClientKey } from './chatPresence'

/** 與 pushSend APP_PRESENCE_TTL_MS 對齊 */
const HEARTBEAT_MS = 15_000

export async function upsertUserAppPresenceOnServer(
  visibility: 'visible' | 'hidden',
): Promise<void> {
  try {
    const { error } = await supabase.rpc('upsert_user_app_presence', {
      p_client_key: getPushClientKey(),
      p_visibility: visibility,
    })
    if (error) console.warn('[appPresence] upsert', error.message)
  } catch {
    /* offline / 無 session */
  }
}

/** 登入後全 App 心跳：Webhook 依此略過 verification_approved 推播 */
export function useAppPresenceHeartbeat(userId: string | undefined): void {
  useEffect(() => {
    if (!userId) return

    const tick = () => {
      const visible =
        typeof document === 'undefined' || document.visibilityState === 'visible'
      void upsertUserAppPresenceOnServer(visible ? 'visible' : 'hidden')
    }

    tick()
    const intervalId = window.setInterval(tick, HEARTBEAT_MS)
    const onVisibility = () => tick()
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      window.clearInterval(intervalId)
      document.removeEventListener('visibilitychange', onVisibility)
      void upsertUserAppPresenceOnServer('hidden')
    }
  }, [userId])
}
