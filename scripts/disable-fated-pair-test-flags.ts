/** 關閉天選／地選任意日測試旗標，改回週四地選、週五天選正式排程 */
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
  const testKeys = ['fated_pair_any_day', 'fated_pair_any_day_heaven', 'fated_pair_any_day_earth'] as const

  for (const k of testKeys) {
    const { error } = await supabase.from('app_feature_flags').update({ enabled: false }).eq('key', k)
    if (error) throw new Error(`${k}: ${error.message}`)
  }

  const { error: enErr } = await supabase.from('app_feature_flags').update({ enabled: true }).eq('key', 'fated_pair_enabled')
  if (enErr) throw enErr

  const { data: flags, error: flagErr } = await supabase
    .from('app_feature_flags')
    .select('key, enabled')
    .like('key', 'fated_pair%')
    .order('key')
  if (flagErr) throw flagErr

  console.log('正式排程已啟用（週四地選、週五天選）：')
  for (const row of flags ?? []) console.log(`  ${row.key} = ${row.enabled}`)

  const [{ data: day }, { data: heavenOn }, { data: earthOn }] = await Promise.all([
    supabase.rpc('app_day_key_now'),
    supabase.rpc('fated_pair_heaven_active_for_day'),
    supabase.rpc('fated_pair_earth_active_for_day'),
  ])
  console.log(`app_day_key: ${day} | heaven_on: ${heavenOn} | earth_on: ${earthOn}`)
}

void main()
