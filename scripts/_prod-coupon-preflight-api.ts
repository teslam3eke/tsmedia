/**
 * Production preflight via Supabase service_role（無 DB password 時）
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function loadEnv() {
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
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')

  const admin = createClient(url, key)

  const mig162 = await admin.from('coupon_campaign_definitions').select('campaign_key').limit(1)
  const mig161Table = await admin
    .from('verification_approval_email_deliveries' as 'profiles')
    .select('id')
    .limit(1)

  const promos = await admin
    .from('payment_promo_campaigns')
    .select('id, label, discount_tenths, cancelled_at, starts_at, ends_at')
    .order('created_at', { ascending: false })
    .limit(30)

  const pricing = await admin.rpc('get_public_payment_pricing')

  const entitlements = await admin.from('user_coupon_entitlements').select('id', { count: 'exact', head: true })

  const now = Date.now()
  const rows = promos.data ?? []
  const wouldBump = rows.filter((r) => {
    if (r.discount_tenths >= 5) return false
    if (r.cancelled_at) return false
    return new Date(r.ends_at).getTime() > now
  })
  const historicalUnder5 = rows.filter((r) => {
    if (r.discount_tenths >= 5) return false
    return Boolean(r.cancelled_at) || new Date(r.ends_at).getTime() <= now
  })

  console.log(
    JSON.stringify(
      {
        migration162TableExists: mig162.error?.code !== 'PGRST205' && mig162.error?.message !== undefined
          ? !mig162.error
          : !mig162.error,
        migration162Error: mig162.error?.message ?? null,
        migration161DeliveriesTable: {
          ok: !mig161Table.error,
          error: mig161Table.error?.message ?? null,
        },
        entitlementCount: entitlements.count,
        malePricing: (pricing.data as { membership?: { male?: unknown } })?.membership?.male,
        wouldBumpToFive: wouldBump,
        historicalUnder5InSample: historicalUnder5,
        promoCampaigns: rows,
      },
      null,
      2,
    ),
  )
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
