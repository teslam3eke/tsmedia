/** 與 coupon_campaign_definitions.eligible_product_key 一致（男性 VIP 月卡 acquisition） */
export const ACQUISITION_COUPON_ELIGIBLE_PRODUCT_KEY = 'membership_male'

export type EcpayCheckoutProductType = 'membership' | 'credit_pack'

/** 所有 ecpay credit_pack 的 pack_key（須與 paymentProducts.CREDIT_PACKS 同步） */
export const ECPAY_CREDIT_PACK_KEYS = [
  'heart_5',
  'super_like_5',
  'blur_unlock_16',
  'crown_effect',
] as const

export type EcpayCreditPackKey = (typeof ECPAY_CREDIT_PACK_KEYS)[number]

export function assertAcquisitionCouponApplicableToCheckout(params: {
  eligibleProductKey: string
  checkoutProductType: EcpayCheckoutProductType
  gender: 'male' | 'female' | null | undefined
}): void {
  if (params.checkoutProductType !== 'membership') {
    throw new Error('COUPON_NOT_APPLICABLE_TO_PRODUCT')
  }
  if (params.gender !== 'male') {
    throw new Error('COUPON_MALE_ONLY')
  }
  if (params.eligibleProductKey !== ACQUISITION_COUPON_ELIGIBLE_PRODUCT_KEY) {
    throw new Error('COUPON_NOT_APPLICABLE_TO_PRODUCT')
  }
}
