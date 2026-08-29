/**
 * 統計目前仍有效之女性會員（153 migration 延長對象）。
 * npx tsx scripts/count-active-female-members.ts
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'

function loadEnv(): void {
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
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1)
      }
      if (process.env[k] === undefined) process.env[k] = v
    }
  }
}

async function main() {
  loadEnv()
  const url = (process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL)?.trim()
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  if (!url || !key) {
    console.error('缺少 SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY')
    process.exit(1)
  }

  const supabase = createClient(url, key, { auth: { persistSession: false } })
  const { data, error } = await supabase
    .from('profiles')
    .select('id, nickname, name, subscription_expires_at')
    .eq('gender', 'female')
    .eq('account_status', 'active')
    .eq('verification_status', 'approved')
    .gt('subscription_expires_at', new Date().toISOString())

  if (error) throw error

  console.log(`目前有效女性會員: ${data?.length ?? 0} 人（153 將各 +5 months）`)
  for (const row of (data ?? []).slice(0, 20)) {
    const label = row.nickname?.trim() || row.name?.trim() || row.id.slice(0, 8)
    console.log(`  ${label} → ${row.subscription_expires_at}`)
  }
  if ((data?.length ?? 0) > 20) console.log(`  …另有 ${data!.length - 20} 人`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
