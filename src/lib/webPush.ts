import { getPushClientKey } from './chatPresence'
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
      sub = await subscribeFresh(reg)
      if (!sub) return false
    }
    return await upsertPushSubscription(userId, sub)
  } catch (e) {
    console.warn('[webPush] subscribe', e)
    return false
  }
}

async function subscribeFresh(reg: ServiceWorkerRegistration) {
  const key = urlBase64ToUint8Array(VAPID!.trim())
  return reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: key as BufferSource,
  })
}

/** 同 user + client_key 只保留目前 endpoint；iOS 換 endpoint 時清掉舊列 */
async function pruneStalePushSubscriptionsForDevice(
  userId: string,
  clientKey: string,
  keepEndpoint: string,
): Promise<void> {
  const { error } = await supabase
    .from('push_subscriptions')
    .delete()
    .eq('user_id', userId)
    .eq('client_key', clientKey)
    .neq('endpoint', keepEndpoint)
  if (error) console.warn('[webPush] prune same client_key', error.message)
}

async function upsertPushSubscription(
  userId: string,
  sub: PushSubscription,
): Promise<boolean> {
  const json = sub.toJSON()
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) return false

  const clientKey = getPushClientKey()
  const { error } = await supabase.from('push_subscriptions').upsert(
    {
      user_id: userId,
      endpoint: json.endpoint,
      p256dh: json.keys.p256dh,
      auth: json.keys.auth,
      client_key: clientKey,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'endpoint' },
  )
  if (error) {
    console.warn('[webPush] upsert', error.message)
    return false
  }
  await pruneStalePushSubscriptionsForDevice(userId, clientKey, json.endpoint)
  return true
}

/** 端到端推播自測：走 Vercel → push_subscriptions → SW（需已登入）。 */
export async function requestRemotePushSelfTest(): Promise<{
  ok: boolean
  sent?: number
  failed?: number
  error?: string
}> {
  try {
    const { data: sess } = await supabase.auth.getSession()
    const token = sess.session?.access_token
    if (!token) return { ok: false, error: '未登入' }
    const res = await fetch('/api/push-test-self', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ clientKey: getPushClientKey() }),
    })
    const body = (await res.json().catch(() => ({}))) as {
      ok?: boolean
      sent?: number
      failed?: number
      error?: string
    }
    if (!res.ok) return { ok: false, error: body.error ?? `HTTP ${res.status}` }
    if (body.ok === false || (body.sent ?? 0) === 0) {
      return {
        ok: false,
        error:
          body.error ??
          '此裝置的遠端推播未送達（請鎖屏再測，或刪除 PWA 重裝後重允許通知）',
      }
    }
    return { ok: true, sent: body.sent, failed: body.failed }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : '請求失敗' }
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
