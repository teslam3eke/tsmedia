/**
 * 診斷兩個測試帳號為何無法觸發天選／地選。
 * npx tsx scripts/diagnose-fated-pair-users.ts founding008@tsmedia.tw teslam3eke@gmail.com
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'

function loadEnv() {
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
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
      if (process.env[k] === undefined) process.env[k] = v
    }
  }
}

const MBTI_RE = /^[EI][NS][FT][JP]$/
const GOLDEN: Array<[string, string, number]> = [
  ['INFJ', 'ENFP', 1], ['INFP', 'ENFJ', 2], ['INTP', 'ENTJ', 3], ['INTJ', 'ENFP', 4],
  ['ENTP', 'INFJ', 5], ['ISFJ', 'ESTP', 6], ['ISTJ', 'ESFP', 7], ['ISTP', 'ESTJ', 8],
  ['ISFP', 'ESFJ', 9], ['ENTP', 'INTJ', 10],
]
const CHALLENGE: Array<[string, string, number]> = [
  ['INTJ', 'ESFP', 1], ['INTP', 'ESFJ', 2], ['ESTJ', 'INFP', 3], ['ISTJ', 'ENFP', 4],
  ['INFJ', 'ESTP', 5], ['ISFP', 'ENTJ', 6], ['ENFJ', 'ISTP', 7], ['ESTP', 'INFP', 9],
]

function pairKey(a: string, b: string) {
  return [a, b].sort().join('|')
}
const goldenMap = new Map(GOLDEN.map(([a, b, r]) => [pairKey(a, b), 11 - r]))
const challengeMap = new Map(CHALLENGE.map(([a, b, r]) => [pairKey(a, b), 11 - r]))

function normRegion(v: string | null) {
  return (v ?? '').trim().toLowerCase()
}
function regionOk(pref: string | null, work: string | null, home: string | null) {
  const p = normRegion(pref)
  if (!p) return true
  return normRegion(work) === p || normRegion(home) === p
}
function overlap(a: string[], b: string[]) {
  const setB = new Set(b)
  return a.filter((x) => setB.has(x))
}

type Profile = {
  id: string
  email: string
  gender: string | null
  mbti_type: string | null
  preferred_region: string | null
  work_region: string | null
  home_region: string | null
  interests: string[]
  photo_count: number
  nickname: string | null
  account_status: string | null
  fated_heaven_dismissed_forever: boolean | null
  pool_ok: boolean
}

async function main() {
  loadEnv()
  const emails = process.argv.slice(2).filter(Boolean)
  if (emails.length < 2) {
    console.error('用法: npx tsx scripts/diagnose-fated-pair-users.ts email1 email2')
    process.exit(1)
  }

  const url = (process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL)?.trim()
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  if (!url || !key) throw new Error('missing env')

  const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })

  const { data: flags } = await supabase.from('app_feature_flags').select('key,enabled').in('key', ['fated_pair_enabled', 'fated_pair_any_day'])
  console.log('=== Feature flags ===')
  for (const f of flags ?? []) console.log(`  ${f.key}: ${f.enabled}`)

  const { data: appDay } = await supabase.rpc('app_day_key_now')
  console.log('app_day_key_now:', appDay)

  const profiles: Profile[] = []
  for (const email of emails) {
    const { data: authData, error: authErr } = await supabase.auth.admin.listUsers({ perPage: 1000 })
    if (authErr) throw authErr
    const user = authData.users.find((u) => u.email?.toLowerCase() === email.toLowerCase())
    if (!user) {
      console.error('找不到使用者:', email)
      continue
    }
    const { data: p, error } = await supabase
      .from('profiles')
      .select('id,gender,mbti_type,preferred_region,work_region,home_region,interests,photo_urls,nickname,name,account_status,fated_heaven_dismissed_forever')
      .eq('id', user.id)
      .maybeSingle()
    if (error) throw error
    if (!p) {
      console.error('找不到 profile:', email)
      continue
    }
    const photos = Array.isArray(p.photo_urls) ? p.photo_urls.filter(Boolean) : []
    const interests = [...new Set((Array.isArray(p.interests) ? p.interests : []).map(String).map((s) => s.trim()).filter(Boolean))]
    const mbtiOk = typeof p.mbti_type === 'string' && MBTI_RE.test(p.mbti_type)
    const poolOk =
      p.account_status === 'active'
      && p.gender
      && String(p.nickname ?? p.name ?? '').trim()
      && photos.length >= 1
      && mbtiOk
      && interests.length >= 1

    profiles.push({
      id: user.id,
      email,
      gender: p.gender as string | null,
      mbti_type: p.mbti_type as string | null,
      preferred_region: p.preferred_region as string | null,
      work_region: p.work_region as string | null,
      home_region: p.home_region as string | null,
      interests,
      photo_count: photos.length,
      nickname: p.nickname as string | null,
      account_status: p.account_status as string | null,
      fated_heaven_dismissed_forever: p.fated_heaven_dismissed_forever as boolean | null,
      pool_ok: Boolean(poolOk),
    })
  }

  if (profiles.length < 2) return

  console.log('\n=== 帳號資料 ===')
  for (const p of profiles) {
    console.log(`\n${p.email} (${p.id.slice(0, 8)}…)`)
    console.log('  active:', p.account_status, '| pool_ok:', p.pool_ok)
    console.log('  gender:', p.gender, '| MBTI:', p.mbti_type ?? '(無/無效)')
    console.log('  希望地區:', p.preferred_region ?? '(未設=通過)')
    console.log('  工作/戶籍:', p.work_region, '/', p.home_region)
    console.log('  興趣:', p.interests.join('、') || '(無)')
    console.log('  生活照:', p.photo_count, '| 天選永久略過:', p.fated_heaven_dismissed_forever)
  }

  const [a, b] = profiles
  console.log('\n=== 兩人配對條件 ===')
  console.log('異性:', a.gender !== b.gender ? '✓' : `✗ 同為 ${a.gender}`)
  const aToB = regionOk(a.preferred_region, b.work_region, b.home_region)
  const bToA = regionOk(b.preferred_region, a.work_region, a.home_region)
  console.log('A→B 地區:', aToB ? '✓' : '✗', `(A希望=${a.preferred_region ?? '任意'}, B工/戶=${b.work_region}/${b.home_region})`)
  console.log('B→A 地區:', bToA ? '✓' : '✗', `(B希望=${b.preferred_region ?? '任意'}, A工/戶=${a.work_region}/${a.home_region})`)
  const shared = overlap(a.interests, b.interests)
  console.log('興趣重疊:', shared.length, shared.length ? `→ ${shared.join('、')}` : '(0 項)')
  const gScore = a.mbti_type && b.mbti_type ? goldenMap.get(pairKey(a.mbti_type, b.mbti_type)) ?? 0 : 0
  const cScore = a.mbti_type && b.mbti_type ? challengeMap.get(pairKey(a.mbti_type, b.mbti_type)) ?? 0 : 0
  console.log('Golden 分:', gScore, gScore > 0 ? '✓ 天選 MBTI OK' : '✗ 不在 Golden 表')
  console.log('Challenge 分:', cScore, cScore > 0 ? '✓ 地選 MBTI OK' : '✗ 不在 Challenge 表')
  console.log('天選入池:', a.pool_ok && b.pool_ok && a.gender !== b.gender && aToB && bToA && shared.length >= 1 && gScore > 0 ? '✓' : '✗')
  console.log('地選入池:', a.pool_ok && b.pool_ok && a.gender !== b.gender && aToB && bToA && shared.length === 0 && cScore > 0 ? '✓' : '✗')
  console.log('互選天選:', gScore > 0 && shared.length >= 1 ? '（若雙方彼此都是對方 Golden 最高分才會指派）' : '—')

  const day = String(appDay ?? '')
  const { data: batch } = await supabase.from('fated_pair_batch_runs').select('ran_at').eq('app_day_key', day).maybeSingle()
  console.log('\n=== 當日批次 ===')
  console.log('batch_ran:', batch ? batch.ran_at : '(尚未跑)')

  for (const p of profiles) {
    const { data: assigns } = await supabase
      .from('fated_pair_assignments')
      .select('kind,partner_user_id,golden_score,challenge_score,interest_overlap')
      .eq('app_day_key', day)
      .eq('user_id', p.id)
    const { data: state } = await supabase
      .from('fated_pair_user_day_state')
      .select('*')
      .eq('app_day_key', day)
      .eq('user_id', p.id)
      .maybeSingle()

    console.log(`\n${p.email} 指派:`)
    if (!assigns?.length) console.log('  (無)')
    else for (const row of assigns) console.log(' ', row)

    console.log('  day_state:', state ?? '(無)')
  }

  const { data: batchResult, error: batchErr } = await supabase.rpc('fated_pair_run_batch', { p_app_day: day })
  if (batchErr) {
    console.log('\nfated_pair_run_batch 錯誤:', batchErr.message)
  } else {
    console.log('\n重跑 fated_pair_run_batch:', batchResult)
  }

  for (const p of profiles) {
    const { data: assigns } = await supabase
      .from('fated_pair_assignments')
      .select('kind,partner_user_id,golden_score,challenge_score,interest_overlap')
      .eq('app_day_key', day)
      .eq('user_id', p.id)
    console.log(`\n${p.email} 重跑後指派:`)
    if (!assigns?.length) console.log('  (仍無 — 條件或互選未過)')
    else for (const row of assigns) console.log(' ', row)
  }
}

void main()
