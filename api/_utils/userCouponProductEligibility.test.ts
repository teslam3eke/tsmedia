import { describe, expect, it } from 'vitest'
import {
  assertAcquisitionCouponApplicableToCheckout,
  ECPAY_CREDIT_PACK_KEYS,
} from './userCouponProductEligibility'

describe('acquisition coupon product eligibility', () => {
  it('allows male VIP membership checkout', () => {
    expect(() =>
      assertAcquisitionCouponApplicableToCheckout({
        eligibleProductKey: 'membership_male',
        checkoutProductType: 'membership',
        gender: 'male',
      }),
    ).not.toThrow()
  })

  it('rejects female membership', () => {
    expect(() =>
      assertAcquisitionCouponApplicableToCheckout({
        eligibleProductKey: 'membership_male',
        checkoutProductType: 'membership',
        gender: 'female',
      }),
    ).toThrow(/COUPON_MALE_ONLY/)
  })

  it.each(ECPAY_CREDIT_PACK_KEYS)('rejects credit pack %s', (packKey) => {
    expect(() =>
      assertAcquisitionCouponApplicableToCheckout({
        eligibleProductKey: 'membership_male',
        checkoutProductType: 'credit_pack',
        gender: 'male',
      }),
    ).toThrow(/COUPON_NOT_APPLICABLE_TO_PRODUCT/)
    void packKey
  })
})
