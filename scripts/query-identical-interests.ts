/**
 * 統計 profiles 中「興趣完全相同」的人數（唯讀）。
 * 執行：npx tsx scripts/query-identical-interests.ts
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
    const text = fs.readFileSync(filePath, 'utf8')
    for (const line of text.split(/\r?\n/)) {
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

type Row = {
  id: string
  gender: string | null
  interests: unknown
}

async function main() {
  loadRepoEnvFiles()
  const url = (process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL)?.trim()
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  if (!url || !key) {
    console.error('請設定 SUPABASE_SERVICE_ROLE_KEY 與 VITE_SUPABASE_URL')
    process.exit(1)
  }

  const supabase = createClient(url, key, { auth: { persistSession: false } })
  const pageSize = 1000
  let from = 0
  const rows: Row[] = []

  while (true) {
    const { data, error } = await supabase
      .from('profiles')
      .select('id,gender,interests')
      .range(from, from + pageSize - 1)
    if (error) {
      console.error('query error:', error.message)
      process.exit(1)
    }
    if (!data?.length) break
    rows.push(...(data as Row[]))
    if (data.length < pageSize) break
    from += pageSize
  }

  const total = rows.length

  function parse(raw: unknown): string[] {
    if (!Array.isArray(raw)) return []
    return raw.map((x) => String(x ?? '').trim()).filter(Boolean)
  }

  function keyExact(items: string[]): string | null {
    if (items.length === 0) return null
    return JSON.stringify([...new Set(items)].sort((a, b) => a.localeCompare(b, 'zh-Hant')))
  }

  function keyExactly3(items: string[]): string | null {
    const u = [...new Set(items)]
    if (u.length !== 3) return null
    return JSON.stringify([...u].sort((a, b) => a.localeCompare(b, 'zh-Hant')))
  }

  const countDist = new Map<number, number>()
  for (const r of rows) {
    const n = parse(r.interests).length
    countDist.set(n, (countDist.get(n) ?? 0) + 1)
  }

  const rowsWith3Interests = rows.filter((r) => parse(r.interests).length === 3)
  const withInterests = rows.filter((r) => parse(r.interests).length > 0)

  const groupsAny = new Map<string, Row[]>()
  for (const r of withInterests) {
    const k = keyExact(parse(r.interests))!
    const g = groupsAny.get(k) ?? []
    g.push(r)
    groupsAny.set(k, g)
  }
  const multiAny = [...groupsAny.entries()].filter(([, arr]) => arr.length >= 2)

  const groups3 = new Map<string, Row[]>()
  for (const r of rowsWith3Interests) {
    const k = keyExactly3(parse(r.interests))!
    const g = groups3.get(k) ?? []
    g.push(r)
    groups3.set(k, g)
  }
  const multi3 = [...groups3.entries()].filter(([, arr]) => arr.length >= 2)

  const with3plus = rows.filter((r) => parse(r.interests).length >= 3)
  let pairsOverlap3 = 0
  for (let i = 0; i < with3plus.length; i += 1) {
    const setA = new Set(parse(with3plus[i]!.interests))
    for (let j = i + 1; j < with3plus.length; j += 1) {
      const setB = new Set(parse(with3plus[j]!.interests))
      let overlap = 0
      for (const x of setA) if (setB.has(x)) overlap += 1
      if (overlap >= 3) pairsOverlap3 += 1
    }
  }

  type ParsedRow = { id: string; items: string[] }
  const parsed: ParsedRow[] = withInterests.map((r) => ({
    id: r.id,
    items: [...new Set(parse(r.interests))],
  }))

  function overlapCount(a: string[], b: string[]): number {
    const setB = new Set(b)
    let n = 0
    for (const x of a) if (setB.has(x)) n += 1
    return n
  }

  function overlapStats(minOverlap: number) {
    const people = new Set<string>()
    let pairs = 0
    for (let i = 0; i < parsed.length; i += 1) {
      for (let j = i + 1; j < parsed.length; j += 1) {
        const o = overlapCount(parsed[i]!.items, parsed[j]!.items)
        if (o >= minOverlap) {
          pairs += 1
          people.add(parsed[i]!.id)
          people.add(parsed[j]!.id)
        }
      }
    }
    return { pairs, people: people.size }
  }

  function overlapExact(n: number) {
    const people = new Set<string>()
    let pairs = 0
    for (let i = 0; i < parsed.length; i += 1) {
      for (let j = i + 1; j < parsed.length; j += 1) {
        if (overlapCount(parsed[i]!.items, parsed[j]!.items) === n) {
          pairs += 1
          people.add(parsed[i]!.id)
          people.add(parsed[j]!.id)
        }
      }
    }
    return { pairs, people: people.size }
  }

  const atLeast2 = overlapStats(2)
  const atLeast3 = overlapStats(3)
  const overlapExactly2 = overlapExact(2)
  const overlapExactly3 = overlapExact(3)

  const topCombos = [...groups3.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 12)
    .map(([k, arr]) => ({ count: arr.length, interests: JSON.parse(k) as string[] }))

  console.log('=== 興趣統計（不含 MBTI）===')
  console.log('總 profiles 數：', total)
  console.log('興趣個數分布：', Object.fromEntries([...countDist.entries()].sort((a, b) => a[0] - b[0])))
  console.log('有填興趣（≥1）：', withInterests.length)
  console.log('剛好 3 個興趣：', rowsWith3Interests.length)
  console.log('')
  console.log('【至少 2 項相同】')
  console.log(`  配對數：${atLeast2.pairs}`)
  console.log(`  涉及人數（至少有一個同伴）：${atLeast2.people}`)
  console.log('')
  console.log('【至少 3 項相同】')
  console.log(`  配對數：${atLeast3.pairs}`)
  console.log(`  涉及人數：${atLeast3.people}`)
  console.log('')
  console.log('【剛好 2 項相同（交集 = 2）】')
  console.log(`  配對數：${overlapExactly2.pairs}`)
  console.log(`  涉及人數：${overlapExactly2.people}`)
  console.log('')
  console.log('【剛好 3 項相同（交集 = 3，第 4 項可不同）】')
  console.log(`  配對數：${overlapExactly3.pairs}`)
  console.log(`  涉及人數：${overlapExactly3.people}`)
  console.log('')
  console.log('【整包興趣完全相同】')
  console.log(`  配對數：${multiAny.length > 0 ? multiAny.reduce((s, [, arr]) => s + (arr.length * (arr.length - 1)) / 2, 0) : 0}`)
  console.log(`  涉及人數：${multiAny.reduce((s, [, arr]) => s + arr.length, 0)}`)
  console.log('')
  console.log('最常見的 3 項組合（含只有 1 人的）：')
  for (const c of topCombos) {
    console.log(` - ${c.count} 人｜${c.interests.join('、')}`)
  }
  if (multi3.length > 0) {
    console.log('')
    console.log('有 ≥2 人完全相同的 3 項組合：')
    for (const [k, arr] of multi3) {
      console.log(` - ${arr.length} 人｜${(JSON.parse(k) as string[]).join('、')}`)
    }
  }
}

void main()
