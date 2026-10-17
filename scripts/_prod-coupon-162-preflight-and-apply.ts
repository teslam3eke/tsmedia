/**
 * Production：162 preflight / apply / post-verify（一次性維運腳本）
 * 需要 .env.local：SUPABASE_DB_PASSWORD 或 SUPABASE_DB_URL、SUPABASE_URL
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
  const mode = process.argv[2] ?? 'preflight'
  const client = getClient()
  await client.connect()

  try {
    if (mode === 'preflight') {
      const mig161 = await client.query(`
        select exists (
          select 1 from information_schema.tables
          where table_schema = 'public' and table_name = 'verification_approval_email_deliveries'
        ) as t161,
        exists (
          select 1 from pg_proc p
          join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname = 'claim_verification_approval_email_delivery'
        ) as fn161
      `)
      const mig162 = await client.query(`
        select exists (
          select 1 from information_schema.tables
          where table_schema = 'public' and table_name = 'coupon_campaign_definitions'
        ) as t162
      `)
      const promos = await client.query(`
        select id, label, discount_tenths, cancelled_at, starts_at, ends_at,
          (cancelled_at is null and ends_at > now()) as may_still_apply
        from public.payment_promo_campaigns
        order by created_at desc
        limit 30
      `)
      const listPrice = await client.query(`
        select public._payment_list_price_ntd('membership_male') as male_list
      `).catch(() => ({ rows: [{ male_list: null }] }))
      const bumpPreview = await client.query(`
        select id, label, discount_tenths
        from public.payment_promo_campaigns
        where discount_tenths < 5
          and cancelled_at is null
          and ends_at > now()
      `)
      console.log(JSON.stringify({
        migration161: mig161.rows[0],
        migration162Applied: mig162.rows[0]?.t162 === true,
        maleListPriceNtd: listPrice.rows[0]?.male_list,
        wouldBumpToFive: bumpPreview.rows,
        promoCampaigns: promos.rows,
      }, null, 2))
      return
    }

    if (mode === 'apply') {
      const sqlPath = path.join(root, 'supabase/migrations/162_user_coupon_entitlements.sql')
      const sql = fs.readFileSync(sqlPath, 'utf8')
      await client.query(sql)
      console.log('migration 162 applied ok')
      return
    }

    if (mode === 'postverify') {
      const checks = await client.query(`
        select
          (select count(*) from public.coupon_campaign_definitions) as def_count,
          (select count(*) from public.user_coupon_entitlements) as ent_count,
          (select count(*) from public.coupon_campaign_definitions where campaign_key = 'APPROVED_48H_200') as c48,
          (select count(*) from public.coupon_campaign_definitions where campaign_key = 'APPROVED_7D_30PCT') as c7d
      `)
      const hist = await client.query(`
        select id, label, discount_tenths, cancelled_at, ends_at
        from public.payment_promo_campaigns
        where discount_tenths < 5
        order by created_at
      `)
      const pricing = await client.query(`select public.get_public_payment_pricing() as p`)
      console.log(JSON.stringify({
        checks: checks.rows[0],
        historicalUnderFive: hist.rows,
        publicPricing: pricing.rows[0]?.p,
      }, null, 2))
      return
    }

    if (mode === 'rpc-privileges') {
      const fns = [
        'issue_user_coupon_entitlement_for_service',
        'reserve_user_coupon_for_ecpay_order',
        'attempt_user_coupon_redemption_for_ecpay_order',
        'reconcile_ecpay_coupon_redemption_for_service',
        'release_user_coupon_reservation_for_ecpay',
      ]
      const rows = []
      for (const fn of fns) {
        const r = await client.query(
          `
          select
            has_function_privilege('authenticated', 'public.${fn}(' ||
              pg_get_function_identity_arguments(p.oid) || ')', 'EXECUTE') as auth_exec,
            has_function_privilege('service_role', 'public.${fn}(' ||
              pg_get_function_identity_arguments(p.oid) || ')', 'EXECUTE') as service_exec
          from pg_proc p
          join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname = $1
          limit 1
        `,
          [fn],
        )
        rows.push({ fn, ...(r.rows[0] ?? {}) })
      }
      const tbl = await client.query(`
        select
          has_table_privilege('authenticated', 'public.user_coupon_entitlements', 'INSERT') as auth_ins,
          has_table_privilege('authenticated', 'public.user_coupon_entitlements', 'UPDATE') as auth_upd,
          has_table_privilege('service_role', 'public.user_coupon_entitlements', 'INSERT') as svc_ins
      `)
      console.log(JSON.stringify({ functions: rows, table: tbl.rows[0] }, null, 2))
      return
    }

    throw new Error(`unknown mode: ${mode}`)
  } finally {
    await client.end()
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
