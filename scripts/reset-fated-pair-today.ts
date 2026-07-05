/** 清除當 app 日天選（週五）／地選（週四）指派與狀態（本地重測用） */
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

  const tables = [
    'fated_pair_assignments',
    'fated_pair_batch_runs',
    'fated_pair_user_day_state',
    'daily_discover_deck',
  ] as const

  for (const table of tables) {
    const { error, count } = await supabase.from(table).delete({ count: 'exact' }).eq('app_day_key', day)
    if (error) throw new Error(`${table}: ${error.message}`)
    console.log(`${table}: deleted ${count ?? 0}`)
  }

  console.log('OK — 硬重整 PWA 後登入，fated_pair_poll 會重新批次指派')
}

void main()
