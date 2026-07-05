/**
 * 用 Golden Pairs / 挑戰組合表粗估天選／地選池（唯讀）。
 * 執行：npx tsx scripts/query-mbti-golden-pairs.ts
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

/** 排名 1 = 最適（分數 10）；未上榜 = 0 */
const GOLDEN_PAIRS: Array<[string, string, number]> = [
  ['INFJ', 'ENFP', 1],
  ['INFP', 'ENFJ', 2],
  ['INTP', 'ENTJ', 3],
  ['INTJ', 'ENFP', 4],
  ['ENTP', 'INFJ', 5],
  ['ISFJ', 'ESTP', 6],
  ['ISTJ', 'ESFP', 7],
  ['ISTP', 'ESTJ', 8],
  ['ISFP', 'ESFJ', 9],
  ['ENTP', 'INTJ', 10],
]

const CHALLENGE_PAIRS: Array<[string, string, number]> = [
  ['INTJ', 'ESFP', 1],
  ['INTP', 'ESFJ', 2],
  ['ESTJ', 'INFP', 3],
  ['ISTJ', 'ENFP', 4],
  ['INFJ', 'ESTP', 5],
  ['ISFP', 'ENTJ', 6],
  ['ENFJ', 'ISTP', 7],
  ['ESFJ', 'INTP', 8],
  ['ESTP', 'INFP', 9],
  ['ENTJ', 'ISFP', 10],
]

function pairKey(a: string, b: string): string {
  return [a, b].sort().join('|')
}

function buildScoreMap(pairs: Array<[string, string, number]>) {
  const map = new Map<string, number>()
  for (const [x, y, rank] of pairs) {
    const score = 11 - rank // rank1→10, rank10→1
    map.set(pairKey(x, y), score)
  }
  return map
}

const goldenScore = buildScoreMap(GOLDEN_PAIRS)
const challengeScore = buildScoreMap(CHALLENGE_PAIRS)

function goldenCompat(a: string, b: string): number {
  return goldenScore.get(pairKey(a, b)) ?? 0
}

function challengeCompat(a: string, b: string): number {
  return challengeScore.get(pairKey(a, b)) ?? 0
}

type P = {
  id: string
  gender: string
  mbti: string
  preferred_region: string | null
  work_region: string | null
  home_region: string | null
  items: string[]
}

function normRegion(v: string | null): string {
  return (v ?? '').trim().toLowerCase()
}

function regionOk(viewer: P, target: P): boolean {
  const pref = normRegion(viewer.preferred_region)
  if (!pref) return true
  return normRegion(target.work_region) === pref || normRegion(target.home_region) === pref
}

function pairRegionOk(a: P, b: P): boolean {
  return regionOk(a, b) && regionOk(b, a)
}

function overlap(a: string[], b: string[]): number {
  const setB = new Set(b)
  let n = 0
  for (const x of a) if (setB.has(x)) n += 1
  return n
}

function genderOk(a: P, b: P): boolean {
  return a.gender !== b.gender
}

async function main() {
  loadEnv()
  const url = (process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL)?.trim()
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  if (!url || !key) throw new Error('missing env')

  const supabase = createClient(url, key, { auth: { persistSession: false } })
  const { data, error } = await supabase
    .from('profiles')
    .select('id,gender,preferred_region,work_region,home_region,mbti_type,interests,account_status')
    .eq('account_status', 'active')
  if (error) throw error

  const all = (data ?? []).map((r) => ({
    id: String(r.id),
    gender: String(r.gender ?? ''),
    mbti: String(r.mbti_type ?? ''),
    preferred_region: r.preferred_region as string | null,
    work_region: r.work_region as string | null,
    home_region: r.home_region as string | null,
    items: [...new Set((Array.isArray(r.interests) ? r.interests : []).map((x) => String(x ?? '').trim()).filter(Boolean))],
  }))

  const withMbti = all.filter((p) => MBTI_RE.test(p.mbti) && p.gender && p.items.length > 0)
  const mbtiCounts = new Map<string, number>()
  for (const p of withMbti) mbtiCounts.set(p.mbti, (mbtiCounts.get(p.mbti) ?? 0) + 1)

  type Edge = { a: P; b: P; gScore: number; cScore: number; ov: number }

  const goldenEdges: Edge[] = []
  const challengeEdges: Edge[] = []

  for (let i = 0; i < withMbti.length; i += 1) {
    for (let j = i + 1; j < withMbti.length; j += 1) {
      const a = withMbti[i]!
      const b = withMbti[j]!
      if (!genderOk(a, b) || !pairRegionOk(a, b)) continue
      const g = goldenCompat(a.mbti, b.mbti)
      const c = challengeCompat(a.mbti, b.mbti)
      const ov = overlap(a.items, b.items)
      if (g > 0 && ov >= 1) goldenEdges.push({ a, b, gScore: g, cScore: c, ov })
      if (c > 0 && ov === 0) challengeEdges.push({ a, b, gScore: g, cScore: c, ov })
    }
  }

  /** 互為天選：雙方在 eligible 裡對彼此 golden 分最高（且 >0） */
  function bestGoldenPartner(self: P, edges: Edge[]): P | null {
    let best: { peer: P; score: number; ov: number } | null = null
    for (const e of edges) {
      const peer = e.a.id === self.id ? e.b : e.b.id === self.id ? e.a : null
      if (!peer) continue
      if (e.gScore <= 0) continue
      if (!best || e.gScore > best.score || (e.gScore === best.score && e.ov > best.ov)) {
        best = { peer, score: e.gScore, ov: e.ov }
      }
    }
    return best?.peer ?? null
  }

  const mutualHeaven: Array<{ a: P; b: P; gScore: number; pair: string }> = []
  const seen = new Set<string>()
  for (const p of withMbti) {
    const best = bestGoldenPartner(p, goldenEdges)
    if (!best) continue
    const back = bestGoldenPartner(best, goldenEdges)
    if (!back || back.id !== p.id) continue
    const key = pairKey(p.id, best.id)
    if (seen.has(key)) continue
    seen.add(key)
    mutualHeaven.push({
      a: p,
      b: best,
      gScore: goldenCompat(p.mbti, best.mbti),
      pair: `${p.mbti}×${best.mbti}`,
    })
  }

  console.log('=== MBTI Golden Pairs 粗估（active、有興趣、有 MBTI）===')
  console.log('符合基本池人數：', withMbti.length)
  console.log('MBTI 分布：', Object.fromEntries([...mbtiCounts.entries()].sort((a, b) => b[1] - a[1])))
  console.log('')
  console.log('【天選候選】Golden 表 + 興趣≥1 + 異性 + 雙向地區（同分比重疊數）：')
  console.log('  配對數（不要求互選）：', goldenEdges.length)
  console.log('  涉及人數：', new Set(goldenEdges.flatMap((e) => [e.a.id, e.b.id])).size)
  console.log('  互為天選（雙方彼此都是對方 Golden 最高分）：', mutualHeaven.length, '對')
  if (mutualHeaven.length > 0) {
    for (const m of mutualHeaven) {
      console.log(`   · ${m.pair}（分${m.gScore}）｜${m.a.gender}/${m.a.mbti} ↔ ${m.b.gender}/${m.b.mbti}`)
    }
  }
  console.log('')
  console.log('【地選候選】挑戰表 + 興趣0重疊 + 異性 + 雙向地區：')
  console.log('  配對數：', challengeEdges.length)
  console.log('  涉及人數：', new Set(challengeEdges.flatMap((e) => [e.a.id, e.b.id])).size)
  console.log('')
  console.log('【參考】若只算 Golden 表、不管興趣/地區/性別：')
  let goldenTypePairsPossible = 0
  for (const [x, y] of GOLDEN_PAIRS.map(([a, b]) => [a, b] as const)) {
    const xs = withMbti.filter((p) => p.mbti === x).length
    const ys = withMbti.filter((p) => p.mbti === y).length
    if (xs > 0 && ys > 0) goldenTypePairsPossible += 1
  }
  console.log('  池子裡「兩種類型都有人」的 Golden 組合：', goldenTypePairsPossible, '/ 10')
}

void main()
