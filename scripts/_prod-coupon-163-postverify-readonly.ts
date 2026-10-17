/**
 * Production 唯讀：163 post-migration verification（不寫入 DB）
 * npx tsx scripts/_prod-coupon-163-postverify-readonly.ts
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

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

function getClient() {
  const password = process.env.SUPABASE_DB_PASSWORD?.trim()
  const urlOverride = process.env.SUPABASE_DB_URL?.trim()
  const projectUrl = (process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL)?.trim()
  if (!password && !urlOverride) {
    throw new Error('請設定 SUPABASE_DB_PASSWORD 或 SUPABASE_DB_URL')
  }
  let connectionString = urlOverride
  if (!connectionString) {
    const ref = projectUrl ? new URL(projectUrl).hostname.split('.')[0] : ''
    if (!ref) throw new Error('missing project ref')
    connectionString = `postgresql://postgres.${ref}:${encodeURIComponent(password!)}@aws-0-ap-northeast-1.pooler.supabase.com:6543/postgres`
  }
  return new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } })
}

async function main() {
  loadEnv()
  const client = getClient()
  await client.connect()
  try {
    const defs = await client.query(`
      select campaign_key, allows_membership_discount_code, stacking_policy, updated_at
      from public.coupon_campaign_definitions
      where campaign_key in ('APPROVED_48H_200', 'APPROVED_7D_30PCT')
      order by campaign_key
    `)
    const ent = await client.query(`
      select
        count(*)::int as entitlement_count,
        count(*) filter (where created_at > now() - interval '2 hours')::int as created_last_2h,
        count(*) filter (where updated_at > now() - interval '2 hours')::int as updated_last_2h
      from public.user_coupon_entitlements
    `)
    const listPrice = await client.query(`
      select public._payment_list_price_ntd('membership_male') as male_list
    `)
    const pricingRpc = await client.query(`
      select public.get_public_payment_pricing() as pricing
    `)
    const promos = await client.query(`
      select id, label, discount_tenths, cancelled_at, starts_at, ends_at, created_at, updated_at,
        (cancelled_at is null and ends_at > now()) as may_still_apply
      from public.payment_promo_campaigns
      order by created_at asc
    `)
    const histLow = await client.query(`
      select id, label, discount_tenths, cancelled_at, ends_at, updated_at
      from public.payment_promo_campaigns
      where discount_tenths < 5
      order by created_at
    `)

    const pricing = pricingRpc.rows[0]?.pricing as {
      membership?: { male?: { list_price_ntd?: number; price_ntd?: number } }
      promo?: { label?: string; discount_tenths?: number }
    } | null

    const report = {
      couponDefinitions: defs.rows,
      entitlements: ent.rows[0],
      note163DoesNotTouchEntitlements:
        'migration 163 檔案僅 UPDATE coupon_campaign_definitions（APPROVED_48H_200）',
      maleListFromHelper: listPrice.rows[0]?.male_list,
      publicPricingMale: pricing?.membership?.male ?? null,
      activePromo: pricing?.promo ?? null,
      allPromoCampaignsCount: promos.rows.length,
      historicalBelowFiveTenths: histLow.rows,
    }

    const checks = {
      c48AllowsFalse:
        defs.rows.find((r) => r.campaign_key === 'APPROVED_48H_200')
          ?.allows_membership_discount_code === false,
      c7dAllowsFalse:
        defs.rows.find((r) => r.campaign_key === 'APPROVED_7D_30PCT')
          ?.allows_membership_discount_code === false,
      maleList599: Number(listPrice.rows[0]?.male_list) === 599,
      promoPrice419: pricing?.membership?.male?.price_ntd === 419,
      promo7Tenths: pricing?.promo?.discount_tenths === 7,
    }
    const allPass = Object.values(checks).every(Boolean)

    console.log(JSON.stringify({ checks, allPass, report }, null, 2))
    process.exit(allPass ? 0 : 1)
  } finally {
    await client.end()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
