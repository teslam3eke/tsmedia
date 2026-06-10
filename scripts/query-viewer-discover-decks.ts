/**
 * 查指定 viewer 的 daily_discover_deck（service role）。
 * npm run query:discover-decks -- teslam3eke@gmail.com
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'

function repoRootDir(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
}

function loadRepoEnvFiles(): void {
  const root = repoRootDir()
  for (const name of ['.env.local', '.env'] as const) {
    const filePath = path.join(root, name)
    if (!fs.existsSync(filePath)) continue
    for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
      const t = line.trim()
      if (!t || t.startsWith('#')) continue
      const eq = t.indexOf('=')
      if (eq <= 0) continue
      const key = t.slice(0, eq).trim()
      let val = t.slice(eq + 1).trim()
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1)
      }
      if (process.env[key] === undefined) process.env[key] = val
    }
  }
}

async function resolveUserIdByEmail(
  admin: ReturnType<typeof createClient>['auth']['admin'],
  email: string,
): Promise<string | null> {
  const target = email.trim().toLowerCase()
  for (let page = 1; page <= 10; page += 1) {
    const { data, error } = await admin.listUsers({ page, perPage: 200 })
    if (error) throw error
    for (const u of data.users) {
      if (u.email?.toLowerCase() === target) return u.id
    }
    if (data.users.length < 200) break
  }
  return null
}

async function main() {
  loadRepoEnvFiles()
  const url = (process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL)?.trim()
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  if (!url || !key) {
    console.error('缺少 SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY')
    process.exit(1)
  }

  const email = process.argv[2]?.trim() || 'teslam3eke@gmail.com'
  const supabase = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const viewerId = await resolveUserIdByEmail(supabase.auth.admin, email)
  if (!viewerId) {
    console.error(`找不到 ${email}`)
    process.exit(1)
  }

  const { data: appDay, error: dayErr } = await supabase.rpc('app_day_key_now')
  if (dayErr) {
    console.error('app_day_key_now:', dayErr.message)
    process.exit(1)
  }

  const { data: decks, error: deckErr } = await supabase
    .from('daily_discover_deck')
    .select('app_day_key, target_user_ids, built_at')
    .eq('viewer_user_id', viewerId)
    .order('app_day_key', { ascending: false })
    .limit(8)

  if (deckErr) {
    console.error('daily_discover_deck:', deckErr.message)
    process.exit(1)
  }

  const allIds = [...new Set((decks ?? []).flatMap((d) => d.target_user_ids ?? []))]
  const { data: profiles } = allIds.length
    ? await supabase
        .from('profiles')
        .select('id, name, nickname, founding_member_no, gender')
        .in('id', allIds)
    : { data: [] as { id: string; name: string | null; nickname: string | null; founding_member_no: number | null; gender: string | null }[] }

  const { data: viewerProfile } = await supabase
    .from('profiles')
    .select('name, nickname, gender, preferred_region, login_last_app_day')
    .eq('id', viewerId)
    .single()

  const { data: shownRows } = await supabase
    .from('daily_discover_shown')
    .select('shown_user_id, first_app_day_key, deck_show_count, created_at')
    .eq('viewer_user_id', viewerId)
    .order('first_app_day_key', { ascending: false })
    .limit(30)

  const shownIds = [...new Set((shownRows ?? []).map((s) => s.shown_user_id))]
  const { data: shownProfiles } = shownIds.length
    ? await supabase.from('profiles').select('id, name, nickname, founding_member_no').in('id', shownIds)
    : { data: [] as { id: string; name: string | null; nickname: string | null; founding_member_no: number | null }[] }
  const shownProfileMap = new Map((shownProfiles ?? []).map((p) => [p.id, p]))

  const profileMap = new Map((profiles ?? []).map((p) => [p.id, p]))

  console.log(`viewer: ${email}`)
  console.log(`viewer_id: ${viewerId}`)
  console.log(`app_day_key_now(): ${appDay}`)
  console.log(`gender: ${viewerProfile?.gender ?? '?'} preferred_region: ${viewerProfile?.preferred_region ?? '(未設)'}`)
  console.log(`login_last_app_day: ${viewerProfile?.login_last_app_day ?? '—'}`)
  console.log('')

  const today = String(appDay)
  const yesterday = new Date(`${today}T12:00:00Z`)
  yesterday.setUTCDate(yesterday.getUTCDate() - 1)
  const yesterdayKey = yesterday.toISOString().slice(0, 10)
  console.log(`對照：昨日 app 日 ≈ ${yesterdayKey}；今晚 22:00 後 app 日 = ${today}`)
  console.log('')

  for (const deck of decks ?? []) {
    console.log(`── app_day ${deck.app_day_key} (built_at ${deck.built_at}) ──`)
    if (!deck.target_user_ids?.length) {
      console.log('  (空 deck)')
      continue
    }
    deck.target_user_ids.forEach((id: string, idx: number) => {
      const p = profileMap.get(id)
      const label = p?.nickname?.trim() || p?.name?.trim() || '(無名)'
      const founding = p?.founding_member_no != null ? ` #${p.founding_member_no}` : ''
      const gender = p?.gender ?? '?'
      console.log(`  ${idx + 1}. ${label}${founding} (${gender}) ${id}`)
    })
    console.log('')
  }

  const deckByDay = new Map((decks ?? []).map((d) => [d.app_day_key, d]))
  if (!deckByDay.has(yesterdayKey)) {
    console.log(`⚠ 資料庫沒有 app_day ${yesterdayKey} 的 deck 列（可能當日未開探索或未寫入）`)
    console.log('')
  }

  console.log('── daily_discover_shown（最近）──')
  for (const row of shownRows ?? []) {
    const p = shownProfileMap.get(row.shown_user_id)
    const label = p?.nickname?.trim() || p?.name?.trim() || row.shown_user_id.slice(0, 8)
    const founding = p?.founding_member_no != null ? ` #${p.founding_member_no}` : ''
    console.log(`  ${row.first_app_day_key} ×${row.deck_show_count} ${label}${founding}`)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
