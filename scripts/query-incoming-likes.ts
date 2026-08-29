/**
 * 查指定 viewer 收到的 like / super_like。
 * npx tsx scripts/query-incoming-likes.ts letmesaveyou@livemail.tw
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'

function loadEnv(): void {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  for (const name of ['.env.local', '.env'] as const) {
    const fp = path.join(root, name)
    if (!fs.existsSync(fp)) continue
    for (const line of fs.readFileSync(fp, 'utf8').split(/\r?\n/)) {
      const t = line.trim()
      if (!t || t.startsWith('#')) continue
      const eq = t.indexOf('=')
      if (eq <= 0) continue
      const k = t.slice(0, eq).trim()
      let v = t.slice(eq + 1).trim()
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1)
      }
      if (process.env[k] === undefined) process.env[k] = v
    }
  }
}

async function findUserId(
  supabase: ReturnType<typeof createClient>,
  email: string,
): Promise<string | null> {
  let page = 1
  while (page <= 20) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 })
    if (error) throw error
    const hit = data.users.find((u) => (u.email ?? '').toLowerCase() === email.toLowerCase())
    if (hit) return hit.id
    if (data.users.length < 200) break
    page++
  }
  return null
}

async function main() {
  loadEnv()
  const email = process.argv[2]?.trim()
  if (!email) {
    console.error('用法: npx tsx scripts/query-incoming-likes.ts <viewerEmail>')
    process.exit(1)
  }

  const url = (process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL)?.trim()
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  if (!url || !key) {
    console.error('缺少 SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY')
    process.exit(1)
  }

  const supabase = createClient(url, key, { auth: { persistSession: false } })
  const viewerId = await findUserId(supabase, email)
  if (!viewerId) {
    console.error(`找不到 ${email}`)
    process.exit(1)
  }

  const { data: rows, error } = await supabase
    .from('profile_interactions')
    .select('id, actor_user_id, action, created_at, target_user_id, target_profile_key')
    .in('action', ['like', 'super_like'])
    .order('created_at', { ascending: false })

  if (error) throw error

  const incoming = (rows ?? []).filter(
    (r) =>
      r.target_user_id === viewerId ||
      r.target_profile_key === viewerId ||
      r.target_profile_key === `user:${viewerId}`,
  )

  const actorIds = [...new Set(incoming.map((r) => r.actor_user_id).filter(Boolean))] as string[]
  const { data: profiles } = actorIds.length
    ? await supabase.from('profiles').select('id, nickname, name, age, work_region').in('id', actorIds)
    : { data: [] as { id: string; nickname: string | null; name: string | null; age: number | null; work_region: string | null }[] }

  const profileMap = new Map((profiles ?? []).map((p) => [p.id, p]))

  console.log(`viewer: ${email}`)
  console.log(`viewer_id: ${viewerId}`)
  console.log(`收到 like / super_like: ${incoming.length} 筆`)
  console.log('')

  if (incoming.length === 0) {
    console.log('（無）')
    return
  }

  for (const row of incoming) {
    const p = row.actor_user_id ? profileMap.get(row.actor_user_id) : undefined
    const label = p?.nickname?.trim() || p?.name?.trim() || row.actor_user_id?.slice(0, 8) || '?'
    const age = p?.age != null ? `${p.age} 歲` : '年齡未知'
    const region = p?.work_region ?? '—'
    console.log(
      `  ${row.action} — ${label}（${age}，${region}）at ${row.created_at}`,
    )
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
