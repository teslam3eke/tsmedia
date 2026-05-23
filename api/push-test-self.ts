/**
 * 已登入使用者對自己的 Web Push 端到端測試（與「測試通知」本機 SW 不同路徑）。
 * Authorization: Bearer <Supabase access_token>
 */
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { sendWebPushToUser } from './_utils/pushSend.js'

function bearerToken(req: VercelRequest): string | null {
  const auth = req.headers.authorization?.trim()
  if (!auth?.startsWith('Bearer ')) return null
  const t = auth.slice('Bearer '.length).trim()
  return t.length > 0 ? t : null
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).end()
    return
  }

  const token = bearerToken(req)
  const url = process.env.SUPABASE_URL?.trim()
  const anon = process.env.SUPABASE_ANON_KEY?.trim() ?? process.env.VITE_SUPABASE_ANON_KEY?.trim()
  if (!token || !url || !anon) {
    res.status(401).json({ error: 'unauthorized' })
    return
  }

  const supabase = createClient(url, anon, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  })
  const { data: userData, error: userErr } = await supabase.auth.getUser(token)
  if (userErr || !userData.user?.id) {
    res.status(401).json({ error: 'invalid session' })
    return
  }

  try {
    const rawBody = typeof req.body === 'string' ? JSON.parse(req.body) : req.body ?? {}
    const clientKey =
      typeof rawBody?.clientKey === 'string' ? rawBody.clientKey.trim() : ''
    const result = await sendWebPushToUser(
      userData.user.id,
      {
        title: '遠端推播測試',
        body: '若看到這則，代表伺服器 → APNs/FCM → Service Worker 路徑正常。',
        tag: 'tsmedia-remote-push-test',
        url: '/?tab=profile',
      },
      undefined,
      clientKey ? { clientKey } : undefined,
    )
    if (clientKey && result.sent === 0) {
      res.status(200).json({
        ok: false,
        userId: userData.user.id,
        error: '此裝置的 push 訂閱不存在或送達失敗，請重新開啟 App 後再測',
        ...result,
      })
      return
    }
    res.status(200).json({ ok: true, userId: userData.user.id, ...result })
  } catch (e) {
    console.error('[push-test-self]', e)
    res.status(500).json({ error: 'send failed' })
  }
}
