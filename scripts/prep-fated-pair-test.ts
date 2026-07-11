/**
 * 天選重測一鍵準備：
 * - 清當日天選／地選指派與 state、探索 deck
 * - 清 founding004 的 daily_discover_shown
 * - 清所有配對（含聊天 cascade）
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

async function main() {
  loadEnv()
  const url = (process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL)?.trim()
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  if (!url || !key) throw new Error('missing env')

  const supabase = createClient(url, key, { auth: { persistSession: false } })
  const { data: day, error: dayErr } = await supabase.rpc('app_day_key_now')
  if (dayErr) throw dayErr
  console.log('app_day_key:', day)

  const fatedTables = [
    'fated_pair_assignments',
    'fated_pair_batch_runs',
    'fated_pair_user_day_state',
    'daily_discover_deck',
  ] as const

  for (const table of fatedTables) {
    const { error, count } = await supabase.from(table).delete({ count: 'exact' }).eq('app_day_key', day)
    if (error) throw new Error(`${table}: ${error.message}`)
    console.log(`${table}: deleted ${count ?? 0}`)
  }

  const { data: usersData } = await supabase.auth.admin.listUsers()
  const founding004 = usersData?.users?.find((u) => u.email === 'founding004@tsmedia.tw')
  if (founding004) {
    const { error, count } = await supabase
      .from('daily_discover_shown')
      .delete({ count: 'exact' })
      .eq('viewer_user_id', founding004.id)
    if (error) throw new Error(`daily_discover_shown: ${error.message}`)
    console.log(`daily_discover_shown (founding004): deleted ${count ?? 0}`)
  }

  const { error: matchErr, count: matchCount } = await supabase
    .from('matches')
    .delete({ count: 'exact' })
    .neq('id', '00000000-0000-0000-0000-000000000000')
  if (matchErr) throw new Error(`matches: ${matchErr.message}`)
  console.log(`matches: deleted ${matchCount ?? 0}`)

  const { count: after } = await supabase.from('matches').select('*', { count: 'exact', head: true })
  console.log('matches after:', after ?? 0)
  console.log('OK — 硬重整 PWA，登入 founding004，先進主殼勿開探索')
}

void main()
