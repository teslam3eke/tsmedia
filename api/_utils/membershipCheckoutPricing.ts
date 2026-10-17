import type { PublicPaymentPricing } from './pricingResolver.js'
import type { ResolvedMaleMembershipDiscount } from './membershipDiscount.js'

/** 與 ECPay 訂單 check (amount_ntd > 0) 及既有 male 折扣碼 floor 對齊（無 acquisition coupon 時） */
export const MIN_ECPAY_MEMBERSHIP_AMOUNT_NTD = 1

/** 使用 acquisition user coupon 時，checkout 最終 floor（僅 coupon 路徑） */
export const MIN_ACQUISITION_COUPON_CHECKOUT_NTD = 99

export const USER_COUPON_CAMPAIGN = {
  APPROVED_48H_200: 'APPROVED_48H_200',
  APPROVED_7D_30PCT: 'APPROVED_7D_30PCT',
} as const

export type UserCouponCampaignKey =
  (typeof USER_COUPON_CAMPAIGN)[keyof typeof USER_COUPON_CAMPAIGN]

export type UserCouponDefinition = {
  campaignKey: UserCouponCampaignKey
  discountKind: 'fixed_amount' | 'pay_ratio_tenths'
  discountValue: number
  stackingPolicy: 'stack_on_promo_price' | 'replace_promo_use_list_price'
  allowsMembershipDiscountCode: boolean
  eligibleProductKey: string
}

export type MembershipCheckoutBreakdown = {
  listPriceNtd: number
  promoPriceNtd: number
  finalAmountNtd: number
  appliedUserCouponCampaign?: UserCouponCampaignKey
  appliedMembershipDiscountCode?: string
}

export class MembershipCheckoutPricingError extends Error {
  constructor(
    message: string,
    readonly code: 'COUPON_STACKING_CONFLICT' | 'INVALID_USER_COUPON',
  ) {
    super(message)
    this.name = 'MembershipCheckoutPricingError'
  }
}

export function applyAcquisitionCouponCheckoutFloor(calculatedAmountNtd: number): number {
  return Math.max(MIN_ACQUISITION_COUPON_CHECKOUT_NTD, calculatedAmountNtd)
}

export function rawPayRatioTenthsAmountNtd(listPriceNtd: number, payRatioTenths: number): number {
  if (payRatioTenths <= 0 || payRatioTenths > 10) {
    throw new MembershipCheckoutPricingError('INVALID_USER_COUPON', 'INVALID_USER_COUPON')
  }
  return Math.floor((listPriceNtd * payRatioTenths) / 10)
}

/** @deprecated 使用 rawPayRatioTenthsAmountNtd + applyAcquisitionCouponCheckoutFloor（coupon 路徑） */
export function payRatioTenthsToAmountNtd(listPriceNtd: number, payRatioTenths: number): number {
  return Math.max(
    MIN_ECPAY_MEMBERSHIP_AMOUNT_NTD,
    rawPayRatioTenthsAmountNtd(listPriceNtd, payRatioTenths),
  )
}

/**
 * 男性 VIP 月卡 checkout 權威金額（ECPay membership；有 user coupon 時套用 NT$99 floor）。
 */
export function computeMaleMembershipCheckoutAmount(input: {
  pricing: PublicPaymentPricing
  membershipDiscount?: ResolvedMaleMembershipDiscount | null
  userCoupon?: UserCouponDefinition | null
}): MembershipCheckoutBreakdown {
  const listPriceNtd = input.pricing.membership.male.list_price_ntd
  const promoPriceNtd = input.pricing.membership.male.price_ntd
  const membershipDiscount = input.membershipDiscount ?? null
  const userCoupon = input.userCoupon ?? null

  if (userCoupon?.stackingPolicy === 'replace_promo_use_list_price') {
    if (membershipDiscount) {
      throw new MembershipCheckoutPricingError(
        'COUPON_STACKING_CONFLICT',
        'COUPON_STACKING_CONFLICT',
      )
    }
    if (userCoupon.discountKind !== 'pay_ratio_tenths') {
      throw new MembershipCheckoutPricingError('INVALID_USER_COUPON', 'INVALID_USER_COUPON')
    }
    const calculated = rawPayRatioTenthsAmountNtd(listPriceNtd, userCoupon.discountValue)
    const finalAmountNtd = applyAcquisitionCouponCheckoutFloor(calculated)
    return {
      listPriceNtd,
      promoPriceNtd,
      finalAmountNtd,
      appliedUserCouponCampaign: userCoupon.campaignKey,
    }
  }

  if (userCoupon) {
    if (userCoupon.stackingPolicy !== 'stack_on_promo_price') {
      throw new MembershipCheckoutPricingError('INVALID_USER_COUPON', 'INVALID_USER_COUPON')
    }
    if (membershipDiscount) {
      throw new MembershipCheckoutPricingError(
        'COUPON_STACKING_CONFLICT',
        'COUPON_STACKING_CONFLICT',
      )
    }
    if (userCoupon.discountKind !== 'fixed_amount') {
      throw new MembershipCheckoutPricingError('INVALID_USER_COUPON', 'INVALID_USER_COUPON')
    }
    const calculated = promoPriceNtd - userCoupon.discountValue
    const finalAmountNtd = applyAcquisitionCouponCheckoutFloor(calculated)
    return {
      listPriceNtd,
      promoPriceNtd,
      finalAmountNtd,
      appliedUserCouponCampaign: userCoupon.campaignKey,
    }
  }

  if (membershipDiscount) {
    return {
      listPriceNtd,
      promoPriceNtd,
      finalAmountNtd: membershipDiscount.finalPriceNtd,
      appliedMembershipDiscountCode: membershipDiscount.code,
    }
  }

  return {
    listPriceNtd,
    promoPriceNtd,
    finalAmountNtd: promoPriceNtd,
  }
}

/** 拒絕 client 偽造金額欄位（若存在則忽略） */
export function stripUntrustedCheckoutPriceFields(body: Record<string, unknown>): void {
  for (const key of [
    'amount',
    'amountNtd',
    'finalPrice',
    'finalPriceNtd',
    'discountAmount',
    'discountNtd',
    'originalPrice',
    'listPrice',
  ]) {
    if (key in body) {
      delete body[key]
    }
  }
}
