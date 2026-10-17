import type { SupabaseClient } from '@supabase/supabase-js'
import {
  USER_COUPON_CAMPAIGN,
  type UserCouponCampaignKey,
} from './membershipCheckoutPricing.js'
import type { PublicPaymentPricing } from './pricingResolver.js'
import { fetchPublicPaymentPricing } from './pricingResolver.js'
import { resolveMaleMembershipCheckout } from './resolveMaleMembershipCheckout.js'

const LIFECYCLE_CAMPAIGN_KEYS: UserCouponCampaignKey[] = [
  USER_COUPON_CAMPAIGN.APPROVED_48H_200,
  USER_COUPON_CAMPAIGN.APPROVED_7D_30PCT,
]

export type AcquisitionEntitlementRow = {
  id: string
  campaign_key: string
  expires_at: string
  status: string
}

export function filterEligibleAcquisitionEntitlements(
  rows: AcquisitionEntitlementRow[],
  nowMs = Date.now(),
): AcquisitionEntitlementRow[] {
  return rows.filter((r) => {
    if (r.status !== 'available') return false
    if (!isLifecycleCampaignKey(r.campaign_key)) return false
    const exp = new Date(r.expires_at).getTime()
    return Number.isFinite(exp) && exp > nowMs
  })
}

export type ScoredAcquisitionEntitlement = {
  row: AcquisitionEntitlementRow
  finalAmountNtd: number
  campaignKey: UserCouponCampaignKey
  entitlementId: string
}

/** 同 final amount 時選 expires_at 較早者。 */
export function pickLowestFinalAmountAcquisitionEntitlement(
  scored: ScoredAcquisitionEntitlement[],
): ScoredAcquisitionEntitlement | null {
  if (!scored.length) return null

  return scored.reduce((best, cur) => {
    if (cur.finalAmountNtd < best.finalAmountNtd) return cur
    if (cur.finalAmountNtd > best.finalAmountNtd) return best

    const curExp = new Date(cur.row.expires_at).getTime()
    const bestExp = new Date(best.row.expires_at).getTime()
    if (Number.isFinite(curExp) && Number.isFinite(bestExp) && curExp < bestExp) return cur
    return best
  })
}

/** 對每張 eligible entitlement 走 authoritative resolve，再選最低 final amount。 */
export async function selectBestAcquisitionCheckoutEntitlement(
  admin: SupabaseClient,
  userId: string,
  pricing: PublicPaymentPricing,
  rows: AcquisitionEntitlementRow[],
  nowMs = Date.now(),
): Promise<ScoredAcquisitionEntitlement | null> {
  const eligible = filterEligibleAcquisitionEntitlements(rows, nowMs)
  const scored: ScoredAcquisitionEntitlement[] = []

  for (const row of eligible) {
    const resolved = await resolveMaleMembershipCheckout(admin, {
      userId,
      pricing,
      userCouponEntitlementIdRaw: row.id,
    })
    if (!resolved.userCouponEntitlementId || !resolved.userCouponCampaign) continue

    scored.push({
      row,
      finalAmountNtd: resolved.amountNtd,
      campaignKey: resolved.userCouponCampaign,
      entitlementId: resolved.userCouponEntitlementId,
    })
  }

  return pickLowestFinalAmountAcquisitionEntitlement(scored)
}

export function acquisitionCouponDisplayLabel(campaignKey: UserCouponCampaignKey): string {
  if (campaignKey === USER_COUPON_CAMPAIGN.APPROVED_48H_200) return 'VIP 現折 $200（限時）'
  return 'VIP 3 折（限時）'
}

export type MyAcquisitionCouponCheckoutPreview = {
  entitlementId: string
  campaignKey: UserCouponCampaignKey
  finalAmountNtd: number
  listPriceNtd: number
  promoPriceNtd: number
  displayLabel: string
  expiresAt: string
}

export async function buildMyAcquisitionCouponCheckoutPreview(
  admin: SupabaseClient,
  userId: string,
): Promise<MyAcquisitionCouponCheckoutPreview | null> {
  const { data: profile, error: profileErr } = await admin
    .from('profiles')
    .select('gender, verification_status')
    .eq('id', userId)
    .maybeSingle()

  if (profileErr || !profile) return null
  if (profile.gender !== 'male') return null
  if (profile.verification_status !== 'approved') return null

  const { data: entitlements, error: entErr } = await admin
    .from('user_coupon_entitlements')
    .select('id, campaign_key, expires_at, status')
    .eq('user_id', userId)
    .in('campaign_key', LIFECYCLE_CAMPAIGN_KEYS)

  if (entErr || !entitlements?.length) return null

  const pricing = await fetchPublicPaymentPricing(admin)
  const best = await selectBestAcquisitionCheckoutEntitlement(
    admin,
    userId,
    pricing,
    entitlements as AcquisitionEntitlementRow[],
  )
  if (!best) return null

  return {
    entitlementId: best.entitlementId,
    campaignKey: best.campaignKey,
    finalAmountNtd: best.finalAmountNtd,
    listPriceNtd: pricing.membership.male.list_price_ntd,
    promoPriceNtd: pricing.membership.male.price_ntd,
    displayLabel: acquisitionCouponDisplayLabel(best.campaignKey),
    expiresAt: best.row.expires_at,
  }
}

function isLifecycleCampaignKey(key: string): key is UserCouponCampaignKey {
  return (LIFECYCLE_CAMPAIGN_KEYS as string[]).includes(key)
}
