/** 粗估天選／地選候選配對（興趣+異性+雙向地區；MBTI 另計） */
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

type P = {
  id: string
  gender: string | null
  preferred_region: string | null
  work_region: string | null
  home_region: string | null
  mbti_type: string | null
  items: string[]
}

function normRegion(v: string | null): string {
  return (v ?? '').trim().toLowerCase()
}

function regionMatches(pref: string | null, work: string | null, home: string | null): boolean {
  const p = normRegion(pref)
  if (!p) return true
  const w = normRegion(work)
  const h = normRegion(home)
  return w === p || h === p
}

function overlap(a: string[], b: string[]): number {
  const setB = new Set(b)
  let n = 0
  for (const x of a) if (setB.has(x)) n += 1
  return n
}

function pairOk(a: P, b: P): boolean {
  if (!a.gender || !b.gender || a.gender === b.gender) return false
  if (!regionMatches(a.preferred_region, b.work_region, b.home_region)) return false
  if (!regionMatches(b.preferred_region, a.work_region, a.home_region)) return false
  return true
}

function countPairs(profiles: P[], pred: (a: P, b: P) => boolean) {
  const people = new Set<string>()
  let pairs = 0
  for (let i = 0; i < profiles.length; i += 1) {
    for (let j = i + 1; j < profiles.length; j += 1) {
      const a = profiles[i]!
      const b = profiles[j]!
      if (!pairOk(a, b)) continue
      if (pred(a, b)) {
        pairs += 1
        people.add(a.id)
        people.add(b.id)
      }
    }
  }
  return { pairs, people: people.size }
}

async function main() {
  loadEnv()
  const url = (process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL)?.trim()
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  if (!url || !key) throw new Error('missing env')

  const supabase = createClient(url, key, { auth: { persistSession: false } })
  const { data, error } = await supabase
    .from('profiles')
    .select('id,gender,preferred_region,work_region,home_region,mbti_type,interests')
    .eq('account_status', 'active')
  if (error) throw error

  const profiles: P[] = (data ?? [])
    .map((r) => ({
      id: String(r.id),
      gender: r.gender as string | null,
      preferred_region: r.preferred_region as string | null,
      work_region: r.work_region as string | null,
      home_region: r.home_region as string | null,
      mbti_type: r.mbti_type as string | null,
      items: [...new Set((Array.isArray(r.interests) ? r.interests : []).map((x) => String(x ?? '').trim()).filter(Boolean))],
    }))
    .filter((p) => p.items.length > 0 && p.gender)

  const withMbti = profiles.filter((p) => p.mbti_type && /^[EI][NS][FT][JP]$/.test(p.mbti_type))

  const heaven = countPairs(profiles, (a, b) => overlap(a.items, b.items) >= 1)
  const earth = countPairs(profiles, (a, b) => overlap(a.items, b.items) === 0)
  const heavenMbti = countPairs(withMbti, (a, b) => overlap(a.items, b.items) >= 1)

  console.log('=== 天選／地選粗估（不含 deck／互選／MBTI 分數，僅興趣+異性+雙向地區）===')
  console.log('有效池（有興趣+性別+active）：', profiles.length)
  console.log('其中有 MBTI：', withMbti.length)
  console.log('')
  console.log('天選興趣條件（≥1 項相同；多位候選再比 Golden 分與重疊數）：')
  console.log('  配對', heaven.pairs, '｜涉及人數', heaven.people)
  console.log('地選興趣條件（0 項相同 = 完全不同）：')
  console.log('  配對', earth.pairs, '｜涉及人數', earth.people)
  console.log('')
  console.log('若再加「雙方都有 MBTI」：')
  console.log('  天選候選配對', heavenMbti.pairs, '｜涉及人數', heavenMbti.people)
}

void main()
