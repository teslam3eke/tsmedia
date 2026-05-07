import { supabase } from './supabase'

const VAPID = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = globalThis.atob(base64)
  const buffer = new ArrayBuffer(rawData.length)
  const out = new Uint8Array(buffer)
  for (let i = 0; i < rawData.length; i++) out[i] = rawData.charCodeAt(i)
  return out
}

/** 使用者已允許通知且環境有 VAPID 公鑰時，註冊 Push 並寫入 `push_subscriptions`。 */
export async function subscribeWebPushForCurrentUser(userId: string): Promise<boolean> {
  if (!VAPID?.trim()) return false
  if (typeof window === 'undefined' || !('Notification' in window)) return false
  if (Notification.permission !== 'granted') return false
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return false

  try {
    const reg = await navigator.serviceWorker.ready
    let sub = await reg.pushManager.getSubscription()
    if (!sub) {
      const key = urlBase64ToUint8Array(VAPID.trim())
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: key as BufferSource,
      })
    }
    const json = sub.toJSON()
    if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) return false

    const { error } = await supabase.from('push_subscriptions').upsert(
      {
        user_id: userId,
        endpoint: json.endpoint,
        p256dh: json.keys.p256dh,
        auth: json.keys.auth,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'endpoint' },
    )
    if (error) {
      console.warn('[webPush] upsert', error.message)
      return false
    }
    return true
  } catch (e) {
    console.warn('[webPush] subscribe', e)
    return false
  }
}

export async function unsubscribeWebPushOnSignOut(): Promise<void> {
  try {
    const reg = await navigator.serviceWorker.ready
    const sub = await reg.pushManager.getSubscription()
    if (sub) {
      const ep = sub.endpoint
      await supabase.from('push_subscriptions').delete().eq('endpoint', ep)
      await sub.unsubscribe()
    }
  } catch {
    /* ignore */
  }
}
