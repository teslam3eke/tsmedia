/**
 * Deploy 後 smoke（唯讀 DB + 本 repo 權威定價邏輯；不發券、不建單）
 * npx tsx scripts/_prod-coupon-stacking-smoke-postdeploy.ts [baseUrl]
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'
import {
  computeMaleMembershipCheckoutAmount,
  MembershipCheckoutPricingError,
  USER_COUPON_CAMPAIGN,
} from '../api/_utils/membershipCheckoutPricing.js'
import { assertAcquisitionCouponApplicableToCheckout } from '../api/_utils/userCouponProductEligibility.js'

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

const coupon48h = {
  campaignKey: USER_COUPON_CAMPAIGN.APPROVED_48H_200,
  discountKind: 'fixed_amount' as const,
  discountValue: 200,
  stackingPolicy: 'stack_on_promo_price' as const,
  allowsMembershipDiscountCode: false,
  eligibleProductKey: 'membership_male',
}

const coupon7d = {
  campaignKey: USER_COUPON_CAMPAIGN.APPROVED_7D_30PCT,
  discountKind: 'pay_ratio_tenths' as const,
  discountValue: 3,
  stackingPolicy: 'replace_promo_use_list_price' as const,
  allowsMembershipDiscountCode: false,
  eligibleProductKey: 'membership_male',
}

function expectConflict(fn: () => unknown) {
  try {
    fn()
    return false
  } catch (e) {
    return e instanceof MembershipCheckoutPricingError && e.code === 'COUPON_STACKING_CONFLICT'
  }
}

async function main() {
  loadEnv()
  const baseUrl = (process.argv[2] ?? 'https://tsmedia.tw').replace(/\/$/, '')
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')

  const admin = createClient(url, key)
  const { data: pricingRaw, error: priceErr } = await admin.rpc('get_public_payment_pricing')
  if (priceErr) throw new Error(priceErr.message)

  const pricing = {
    promo: (pricingRaw as { promo: unknown }).promo,
    membership: (pricingRaw as { membership: unknown }).membership,
    packs: (pricingRaw as { packs?: unknown }).packs ?? {},
  } as Parameters<typeof computeMaleMembershipCheckoutAmount>[0]['pricing']

  const results: Record<string, boolean> = {}

  results.A_48h_only_219 =
    computeMaleMembershipCheckoutAmount({ pricing, userCoupon: coupon48h }).finalAmountNtd === 219

  results.B_48h_TSVIP_conflict = expectConflict(() =>
    computeMaleMembershipCheckoutAmount({
      pricing,
      userCoupon: coupon48h,
      membershipDiscount: { code: 'TSVIP', discountNtd: 100, finalPriceNtd: 319 },
    }),
  )

  results.C_48h_TSFB_conflict = expectConflict(() =>
    computeMaleMembershipCheckoutAmount({
      pricing,
      userCoupon: coupon48h,
      membershipDiscount: { code: 'TSFB', discountNtd: 300, finalPriceNtd: 119 },
    }),
  )

  results.D_48h_arbitrary_code_conflict = expectConflict(() =>
    computeMaleMembershipCheckoutAmount({
      pricing,
      userCoupon: coupon48h,
      membershipDiscount: { code: 'PARTNER', discountNtd: 50, finalPriceNtd: 369 },
    }),
  )

  results.E_7d_only_179 =
    computeMaleMembershipCheckoutAmount({ pricing, userCoupon: coupon7d }).finalAmountNtd === 179

  results.F_7d_TSVIP_conflict = expectConflict(() =>
    computeMaleMembershipCheckoutAmount({
      pricing,
      userCoupon: coupon7d,
      membershipDiscount: { code: 'TSVIP', discountNtd: 100, finalPriceNtd: 319 },
    }),
  )

  results.F2_7d_TSFB_conflict = expectConflict(() =>
    computeMaleMembershipCheckoutAmount({
      pricing,
      userCoupon: coupon7d,
      membershipDiscount: { code: 'TSFB', discountNtd: 300, finalPriceNtd: 119 },
    }),
  )

  results.G_TSVIP_no_coupon =
    computeMaleMembershipCheckoutAmount({
      pricing,
      membershipDiscount: { code: 'TSVIP', discountNtd: 100, finalPriceNtd: 319 },
    }).finalAmountNtd === 319

  results.G2_TSFB_no_coupon =
    computeMaleMembershipCheckoutAmount({
      pricing,
      membershipDiscount: { code: 'TSFB', discountNtd: 300, finalPriceNtd: 119 },
    }).finalAmountNtd === 119

  let itemRejected = false
  try {
    assertAcquisitionCouponApplicableToCheckout({
      eligibleProductKey: 'membership_male',
      checkoutProductType: 'credit_pack',
      gender: 'male',
    })
  } catch {
    itemRejected = true
  }
  results.I_item_checkout_rejects_coupon = itemRejected

  const tapSrc = fs.readFileSync(path.join(root, 'api/tappay-membership.ts'), 'utf8')
  results.H_tappay_rejects_coupon_policy_in_handler =
    tapSrc.includes('userCouponEntitlementId') && tapSrc.includes('此優惠券僅支援綠界付款流程')
  let tapLiveNote: string | null = null
  try {
    const tapRes = await fetch(`${baseUrl}/api/tappay-membership`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userCouponEntitlementId: '00000000-0000-4000-8000-000000000001' }),
    })
    const tapJson = (await tapRes.json()) as { error?: string }
    tapLiveNote = `live HTTP ${tapRes.status}: ${tapJson.error ?? ''}`
  } catch (e) {
    tapLiveNote = e instanceof Error ? e.message : 'fetch failed'
  }

  const capiSrc = fs.readFileSync(path.join(root, 'api/_utils/ecpayMetaCapiPurchase.ts'), 'utf8')
  results.J_capi_event_id_merchant_trade_no =
    capiSrc.includes('eventId: row.merchant_trade_no') && capiSrc.includes('valueNtd: row.amount_ntd')

  const allPass = Object.values(results).every(Boolean)
  console.log(
    JSON.stringify(
      {
        baseUrl,
        deploymentNote: '定價 smoke 使用 Production get_public_payment_pricing + 已 deploy 的同源 TS 邏輯',
        results,
        tapLiveNote,
        allPass,
      },
      null,
      2,
    ),
  )
  process.exit(allPass ? 0 : 1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
