import type { SupabaseClient } from '@supabase/supabase-js'
import type { PublicPaymentPricing } from './pricingResolver.js'
import {
  computeMaleMembershipCheckoutAmount,
  MembershipCheckoutPricingError,
} from './membershipCheckoutPricing.js'
import {
  normalizeMembershipDiscountCode,
  resolveMaleMembershipDiscount,
} from './membershipDiscount.js'
import {
  TsspeMembershipEligibilityError,
  isTsspeMembershipDiscountCode,
  resolveTsspeMaleMembershipDiscount,
} from './tsspeMembershipEligibility.js'
import {
  loadUserCouponEntitlementForCheckout,
  normalizeUserCouponEntitlementId,
  type LoadedUserCouponEntitlement,
} from './userCouponEntitlement.js'

export type ResolvedMaleMembershipCheckout = {
  amountNtd: number
  membershipDiscountCode: string | null
  userCouponEntitlementId: string | null
  userCouponCampaign: string | null
}

export async function resolveMaleMembershipCheckout(
  admin: SupabaseClient,
  params: {
    userId: string
    pricing: PublicPaymentPricing
    membershipDiscountCodeRaw?: unknown
    userCouponEntitlementIdRaw?: unknown
    checkoutProfile?: {
      gender: string | null | undefined
      verification_status: string | null | undefined
      account_status: string | null | undefined
    }
    tsspeGoLiveOverrideIso?: string | null
  },
): Promise<ResolvedMaleMembershipCheckout> {
  const promoBase = params.pricing.membership.male.price_ntd
  const entitlementId = normalizeUserCouponEntitlementId(params.userCouponEntitlementIdRaw)
  const requestedCode = normalizeMembershipDiscountCode(params.membershipDiscountCodeRaw)

  let userCoupon: LoadedUserCouponEntitlement | null = null
  if (entitlementId) {
    userCoupon = await loadUserCouponEntitlementForCheckout(
      admin,
      params.userId,
      entitlementId,
      { checkoutProductType: 'membership', gender: 'male' },
    )
  }

  if (userCoupon && requestedCode) {
    throw new MembershipCheckoutPricingError(
      'COUPON_STACKING_CONFLICT',
      'COUPON_STACKING_CONFLICT',
    )
  }

  let membershipDiscount = null
  if (requestedCode) {
    if (isTsspeMembershipDiscountCode(requestedCode)) {
      if (!params.checkoutProfile) {
        throw new TsspeMembershipEligibilityError('TSSPE_NOT_ELIGIBLE', 'TSSPE_NOT_ELIGIBLE')
      }
      membershipDiscount = await resolveTsspeMaleMembershipDiscount(admin, {
        userId: params.userId,
        profile: params.checkoutProfile,
        promoBasePriceNtd: promoBase,
        goLiveOverrideIso: params.tsspeGoLiveOverrideIso ?? null,
      })
    } else {
      membershipDiscount = await resolveMaleMembershipDiscount(admin, requestedCode, promoBase)
    }
  }

  const breakdown = computeMaleMembershipCheckoutAmount({
    pricing: params.pricing,
    membershipDiscount,
    userCoupon,
  })

  return {
    amountNtd: breakdown.finalAmountNtd,
    membershipDiscountCode: breakdown.appliedMembershipDiscountCode ?? null,
    userCouponEntitlementId: userCoupon?.entitlementId ?? null,
    userCouponCampaign: breakdown.appliedUserCouponCampaign ?? null,
  }
}
