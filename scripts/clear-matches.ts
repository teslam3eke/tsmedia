/** 清空所有配對與雙向 like（本機重測用） */
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

async function main() {
  loadEnv()
  const url = (process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL)?.trim()
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  if (!url || !key) throw new Error('missing VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY')

  const supabase = createClient(url, key, { auth: { persistSession: false } })

  const { count: before } = await supabase.from('matches').select('*', { count: 'exact', head: true })
  console.log('matches before:', before ?? 0)

  const { error: mrErr, count: mrCount } = await supabase
    .from('message_reports')
    .delete({ count: 'exact' })
    .not('match_id', 'is', null)
  if (mrErr) throw new Error(`message_reports: ${mrErr.message}`)
  console.log('message_reports deleted:', mrCount ?? 0)

  const { error: likeErr, count: likeCount } = await supabase
    .from('profile_interactions')
    .delete({ count: 'exact' })
    .in('action', ['like', 'super_like'])
  if (likeErr) throw new Error(`profile_interactions: ${likeErr.message}`)
  console.log('profile_interactions (like/super_like) deleted:', likeCount ?? 0)

  const { error: matchErr, count: matchCount } = await supabase
    .from('matches')
    .delete({ count: 'exact' })
    .neq('id', '00000000-0000-0000-0000-000000000000')
  if (matchErr) throw new Error(`matches: ${matchErr.message}`)
  console.log('matches deleted:', matchCount ?? 0)

  const { count: after } = await supabase.from('matches').select('*', { count: 'exact', head: true })
  console.log('matches after:', after ?? 0)
  console.log('OK — 請硬重整 PWA 後重新進配對列表')
}

void main()
