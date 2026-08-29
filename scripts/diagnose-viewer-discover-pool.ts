/**
 * 診斷指定 viewer 的探索候選池與 deck 重複率。
 * npx tsx scripts/diagnose-viewer-discover-pool.ts letmesaveyou@livemail.tw
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

function regionMatch(
  work: string | null,
  home: string | null,
  region: string,
): boolean {
  const r = region.toLowerCase()
  return (
    (work ?? '').toLowerCase().trim() === r ||
    (home ?? '').toLowerCase().trim() === r
  )
}

function computeStrictAgeBand(
  myAge: number | null,
  savedMin: number | null,
  savedMax: number | null,
): { strictMin: number; strictMax: number } {
  if (savedMin != null && savedMax != null) {
    return { strictMin: savedMin, strictMax: savedMax }
  }
  if (myAge == null) return { strictMin: 18, strictMax: 80 }
  const age = Math.max(18, Math.min(80, myAge))
  let strictMin = Math.max(18, age - 5)
  let strictMax = Math.min(80, age + 5)
  if (strictMax - strictMin < 10) {
    if (strictMin === 18) strictMax = 28
    else strictMin = 70
  }
  return { strictMin, strictMax }
}

type ProfileRow = {
  id: string
  nickname: string | null
  name: string | null
  age: number | null
  work_region: string | null
  home_region: string | null
  founding_member_no: number | null
  gender: string | null
  verification_status: string | null
  account_status: string | null
  photo_urls: string[] | null
}

function label(p: ProfileRow): string {
  return p.nickname?.trim() || p.name?.trim() || p.id.slice(0, 8)
}

function isEligibleFemale(p: ProfileRow, viewerFounding: number | null): boolean {
  if (p.gender !== 'female') return false
  if (p.account_status !== 'active') return false
  if (p.verification_status !== 'approved') return false
  if (!p.nickname?.trim() && !p.name?.trim()) return false
  if (!p.photo_urls || p.photo_urls.length < 1) return false
  if (p.founding_member_no != null && viewerFounding == null) return false
  return true
}

async function main() {
  loadRepoEnvFiles()
  const url = (process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL)?.trim()
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  if (!url || !key) {
    console.error('缺少 SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY')
    process.exit(1)
  }

  const email = process.argv[2]?.trim() || 'letmesaveyou@livemail.tw'
  const supabase = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const viewerId = await resolveUserIdByEmail(supabase.auth.admin, email)
  if (!viewerId) {
    console.error(`找不到 ${email}`)
    process.exit(1)
  }

  const { data: viewer } = await supabase
    .from('profiles')
    .select(
      'age, gender, preferred_region, preferred_age_min, preferred_age_max, founding_member_no',
    )
    .eq('id', viewerId)
    .single()

  const { data: allProfiles } = await supabase
    .from('profiles')
    .select(
      'id, nickname, name, age, work_region, home_region, founding_member_no, gender, verification_status, account_status, photo_urls',
    )

  const { data: matches } = await supabase
    .from('matches')
    .select('user_a, user_b')
    .or(`user_a.eq.${viewerId},user_b.eq.${viewerId}`)

  const matchedIds = new Set(
    (matches ?? []).flatMap((m) => [m.user_a, m.user_b]).filter((id) => id !== viewerId),
  )

  const { data: shownRows } = await supabase
    .from('daily_discover_shown')
    .select('shown_user_id, deck_show_count')
    .eq('viewer_user_id', viewerId)

  const shownMap = new Map(
    (shownRows ?? []).map((r) => [r.shown_user_id, r.deck_show_count ?? 1]),
  )

  const { data: decks } = await supabase
    .from('daily_discover_deck')
    .select('app_day_key, target_user_ids')
    .eq('viewer_user_id', viewerId)
    .order('app_day_key', { ascending: false })
    .limit(14)

  const { strictMin, strictMax } = computeStrictAgeBand(
    viewer?.age ?? null,
    viewer?.preferred_age_min ?? null,
    viewer?.preferred_age_max ?? null,
  )

  const pref = (viewer?.preferred_region ?? '').toLowerCase().trim()
  const females = (allProfiles ?? []).filter((p) =>
    isEligibleFemale(p as ProfileRow, viewer?.founding_member_no ?? null),
  )

  const inAge = (p: ProfileRow, min: number, max: number) =>
    p.age != null && p.age >= min && p.age <= max

  const northFemales = females.filter((p) => regionMatch(p.work_region, p.home_region, 'north'))
  const northInStrictAge = northFemales.filter((p) => inAge(p as ProfileRow, strictMin, strictMax))
  const northInStrictNotShown = northInStrictAge.filter((p) => !shownMap.has(p.id))
  const northInStrictNotShownNotMatched = northInStrictNotShown.filter((p) => !matchedIds.has(p.id))

  const widen3Min = Math.max(18, strictMin - 3)
  const widen3Max = Math.min(80, strictMax + 3)
  const northWiden3Fresh = northFemales.filter(
    (p) =>
      inAge(p as ProfileRow, widen3Min, widen3Max) &&
      !shownMap.has(p.id) &&
      !matchedIds.has(p.id),
  )

  const allInAge = females.filter((p) => inAge(p as ProfileRow, strictMin, strictMax))
  const allNotShownNotMatched = allInAge.filter(
    (p) => !shownMap.has(p.id) && !matchedIds.has(p.id),
  )

  console.log(`viewer: ${email}`)
  console.log(`  age=${viewer?.age ?? '?'} preferred_region=${pref || '(未設)'}`)
  console.log(
    `  preferred_age=${viewer?.preferred_age_min ?? 'null'}-${viewer?.preferred_age_max ?? 'null'} → strict ${strictMin}-${strictMax}`,
  )
  console.log(`  founding_member_no=${viewer?.founding_member_no ?? 'null'}`)
  console.log('')
  console.log('候選池（approved active 女性、有暱稱與照片、一般 deck 不含創始）')
  console.log(`  全站符合條件女性: ${females.length}`)
  console.log(`  北部: ${northFemales.length}`)
  console.log(`  北部 + strict 年齡帶: ${northInStrictAge.length}`)
  console.log(`  北部 + strict 年齡 + 從未 shown: ${northInStrictNotShown.length}`)
  console.log(
    `  北部 + strict 年齡 + 從未 shown + 未配對: ${northInStrictNotShownNotMatched.length}`,
  )
  console.log(`  全區 + strict 年齡 + 從未 shown + 未配對: ${allNotShownNotMatched.length}`)
  console.log(
    `  北部 + 放寬 ±3 歲 (${widen3Min}-${widen3Max}) + 從未 shown: ${northWiden3Fresh.length}`,
  )
  console.log(`  已配對排除: ${matchedIds.size} 人`)
  console.log(`  曾出現在探索 shown: ${shownMap.size} 人`)
  console.log('')

  // deck overlap stats
  const sortedDecks = [...(decks ?? [])].sort((a, b) =>
    a.app_day_key.localeCompare(b.app_day_key),
  )
  const profileMap = new Map((allProfiles ?? []).map((p) => [p.id, p as ProfileRow]))

  let totalOverlap = 0
  let totalCards = 0
  for (let i = 1; i < sortedDecks.length; i++) {
    const prev = new Set(sortedDecks[i - 1].target_user_ids ?? [])
    const curr = sortedDecks[i].target_user_ids ?? []
    totalOverlap += curr.filter((id) => prev.has(id)).length
    totalCards += curr.length
  }
  const avgOverlap = sortedDecks.length > 1 ? totalOverlap / (sortedDecks.length - 1) : 0
  const repeatRate = totalCards > 0 ? totalOverlap / (6 * (sortedDecks.length - 1)) : 0

  console.log(`最近 ${sortedDecks.length} 天 deck 統計`)
  console.log(`  相鄰兩日平均重疊: ${avgOverlap.toFixed(1)} / 6 人 (${(repeatRate * 100).toFixed(0)}%)`)
  console.log('')

  const appearCounts = new Map<string, number>()
  for (const d of sortedDecks) {
    for (const id of d.target_user_ids ?? []) {
      appearCounts.set(id, (appearCounts.get(id) ?? 0) + 1)
    }
  }
  const topRepeat = [...appearCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
  console.log('最常出現（最近 deck 天數內）:')
  for (const [id, c] of topRepeat) {
    const p = profileMap.get(id)
    const shown = shownMap.get(id) ?? 0
    console.log(
      `  ${c}/${sortedDecks.length} 天 deck — shown×${shown} — ${p ? label(p) : id} (age ${p?.age ?? '?'})`,
    )
  }
  console.log('')

  const { data: incomingLikes } = await supabase
    .from('profile_interactions')
    .select('actor_user_id, created_at, target_user_id, target_profile_key')
    .eq('action', 'like')

  const likesToViewer = (incomingLikes ?? []).filter(
    (l) =>
      l.target_user_id === viewerId ||
      l.target_profile_key === viewerId ||
      l.target_profile_key === `user:${viewerId}`,
  )
  const likerCounts = new Map<string, number>()
  for (const l of likesToViewer) {
    if (!l.actor_user_id) continue
    likerCounts.set(l.actor_user_id, (likerCounts.get(l.actor_user_id) ?? 0) + 1)
  }
  const topLikers = [...likerCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
  console.log(`對我送 like 的女性: ${likerCounts.size} 人（共 ${likesToViewer.length} 次）`)
  for (const [id, c] of topLikers) {
    const p = profileMap.get(id)
    console.log(`  ×${c} — ${p ? label(p) : id}`)
  }
  console.log('')

  console.log('相鄰日重疊明細:')
  for (let i = 1; i < sortedDecks.length; i++) {
    const prev = new Set(sortedDecks[i - 1].target_user_ids ?? [])
    const curr = sortedDecks[i].target_user_ids ?? []
    const overlap = curr.filter((id) => prev.has(id))
    const names = overlap.map((id) => {
      const p = profileMap.get(id)
      return p ? label(p) : id.slice(0, 8)
    })
    console.log(
      `  ${sortedDecks[i - 1].app_day_key} → ${sortedDecks[i].app_day_key}: ${overlap.length}/6 — ${names.join(', ') || '(無)'}`,
    )
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
