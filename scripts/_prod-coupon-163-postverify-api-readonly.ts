/**
 * Production 唯讀：163 post-migration（Supabase REST / service_role，不寫入）
 * npx tsx scripts/_prod-coupon-163-postverify-api-readonly.ts
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

  const { data: defs, error: defErr } = await admin
    .from('coupon_campaign_definitions')
    .select('campaign_key, allows_membership_discount_code, stacking_policy, updated_at')
    .in('campaign_key', ['APPROVED_48H_200', 'APPROVED_7D_30PCT'])
    .order('campaign_key')

  if (defErr) throw new Error(defErr.message)

  const ent = await admin.from('user_coupon_entitlements').select('id', { count: 'exact', head: true })

  const { data: pricingRaw, error: priceErr } = await admin.rpc('get_public_payment_pricing')
  if (priceErr) throw new Error(priceErr.message)

  const pricing = pricingRaw as {
    membership?: { male?: { list_price_ntd?: number; price_ntd?: number } }
    promo?: { label?: string; discount_tenths?: number; id?: string }
  }

  const { data: promos, error: promoErr } = await admin
    .from('payment_promo_campaigns')
    .select('id, label, discount_tenths, cancelled_at, starts_at, ends_at, created_at, updated_at')
    .order('created_at', { ascending: true })

  if (promoErr) throw new Error(promoErr.message)

  const histLow = (promos ?? []).filter((r) => r.discount_tenths < 5)

  const c48 = defs?.find((r) => r.campaign_key === 'APPROVED_48H_200')
  const c7d = defs?.find((r) => r.campaign_key === 'APPROVED_7D_30PCT')

  const checks = {
    c48AllowsFalse: c48?.allows_membership_discount_code === false,
    c7dAllowsFalse: c7d?.allows_membership_discount_code === false,
    maleList599: pricing.membership?.male?.list_price_ntd === 599,
    promoPrice419: pricing.membership?.male?.price_ntd === 419,
    promo7Tenths: pricing.promo?.discount_tenths === 7,
    entitlementsReadable: !ent.error,
    entitlementsCountIsNumber: typeof ent.count === 'number',
  }

  const allPass = Object.values(checks).every(Boolean)

  console.log(
    JSON.stringify(
      {
        checks,
        allPass,
        couponDefinitions: defs,
        entitlementCount: ent.count,
        note163:
          '163 僅 UPDATE APPROVED_48H_200 allows flag；entitlements 表無 DML（以 count 唯讀確認可讀）',
        publicPricingMale: pricing.membership?.male,
        activePromo: pricing.promo,
        historicalBelowFiveTenths: histLow,
        promoCampaignRowCount: promos?.length ?? 0,
      },
      null,
      2,
    ),
  )
  process.exit(allPass ? 0 : 1)
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
