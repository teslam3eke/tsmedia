/**
 * POST /api/delete-account
 * Authorization: Bearer <Supabase access_token>
 * 刪除目前登入使用者（auth.users；關聯資料庫列 on delete cascade）。
 */
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

function bearerToken(req: VercelRequest): string | null {
  const auth = req.headers.authorization?.trim()
  if (!auth?.startsWith('Bearer ')) return null
  const t = auth.slice('Bearer '.length).trim()
  return t.length > 0 ? t : null
}

function readSupabaseEnv(): { url: string; anon: string; serviceKey: string } | null {
  const url = process.env.SUPABASE_URL?.trim() ?? process.env.VITE_SUPABASE_URL?.trim()
  const anon =
    process.env.SUPABASE_ANON_KEY?.trim() ?? process.env.VITE_SUPABASE_ANON_KEY?.trim()
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  if (!url || !anon || !serviceKey) return null
  return { url, anon, serviceKey }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  res.setHeader('Cache-Control', 'no-store')

  if (req.method === 'OPTIONS') {
    return res.status(204).end()
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, message: 'Method not allowed' })
  }

  const env = readSupabaseEnv()
  const token = bearerToken(req)
  if (!env || !token) {
    return res.status(401).json({ ok: false, message: '請先登入後再試。' })
  }

  const userClient = createClient(env.url, env.anon, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  })
  const { data: userData, error: userErr } = await userClient.auth.getUser(token)
  const userId = userData.user?.id
  if (userErr || !userId) {
    return res.status(401).json({ ok: false, message: '登入已失效，請重新登入。' })
  }

  const admin = createClient(env.url, env.serviceKey)
  const { data: profile, error: profileErr } = await admin
    .from('profiles')
    .select('is_admin')
    .eq('id', userId)
    .maybeSingle()

  if (profileErr) {
    console.error('[delete-account] profile read failed:', profileErr.message)
    return res.status(500).json({ ok: false, message: '無法確認帳號狀態，請稍後再試。' })
  }

  if (profile?.is_admin) {
    return res.status(403).json({ ok: false, message: '管理員帳號無法自行刪除，請聯絡技術支援。' })
  }

  const { error: deleteErr } = await admin.auth.admin.deleteUser(userId)
  if (deleteErr) {
    console.error('[delete-account] deleteUser failed:', deleteErr.message)
    return res.status(500).json({ ok: false, message: '刪除帳號失敗，請稍後再試或聯絡客服。' })
  }

  return res.status(200).json({ ok: true, message: '帳號已刪除。' })
}
