import { describe, expect, it } from 'vitest'
import {
  USER_COUPON_CAMPAIGN,
  applyAcquisitionCouponCheckoutFloor,
  computeMaleMembershipCheckoutAmount,
  rawPayRatioTenthsAmountNtd,
  MembershipCheckoutPricingError,
  stripUntrustedCheckoutPriceFields,
} from './membershipCheckoutPricing'
import { generalPromoPriceFromListNtd } from './paymentPromoCampaign'

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

const maleList599 = 599
const malePromo5Tenths = generalPromoPriceFromListNtd(maleList599, 5)
const malePromo7Tenths = generalPromoPriceFromListNtd(maleList599, 7)

const pricingAt5Tenths = {
  promo: { id: 'x', label: '5折', discount_tenths: 5, ends_at: '', product_keys: ['all'] },
  membership: {
    male: { list_price_ntd: maleList599, price_ntd: malePromo5Tenths },
    female: { list_price_ntd: 299, price_ntd: 149 },
  },
  packs: {},
}

const pricingAt7TenthsProduction = {
  promo: { id: 'y', label: '7折', discount_tenths: 7, ends_at: '', product_keys: ['all'] },
  membership: {
    male: { list_price_ntd: maleList599, price_ntd: malePromo7Tenths },
    female: { list_price_ntd: 299, price_ntd: 209 },
  },
  packs: {},
}

function expectStackingConflict(fn: () => unknown) {
  expect(fn).toThrow(MembershipCheckoutPricingError)
  try {
    fn()
  } catch (e) {
    expect(e).toMatchObject({ code: 'COUPON_STACKING_CONFLICT' })
  }
}

describe('user coupon campaigns exist', () => {
  it('defines APPROVED_48H_200 and APPROVED_7D_30PCT', () => {
    expect(USER_COUPON_CAMPAIGN.APPROVED_48H_200).toBe('APPROVED_48H_200')
    expect(USER_COUPON_CAMPAIGN.APPROVED_7D_30PCT).toBe('APPROVED_7D_30PCT')
  })
})

describe('Production 48h (list 599, promo 7折 → 419)', () => {
  it('48h only → 219', () => {
    expect(malePromo7Tenths).toBe(419)
    const r = computeMaleMembershipCheckoutAmount({
      pricing: pricingAt7TenthsProduction,
      userCoupon: coupon48h,
    })
    expect(r.finalAmountNtd).toBe(219)
  })
})

describe('male VIP pricing with 5折 general promo (list 599)', () => {
  it('A list price only', () => {
    const r = computeMaleMembershipCheckoutAmount({
      pricing: {
        ...pricingAt5Tenths,
        membership: {
          ...pricingAt5Tenths.membership,
          male: { list_price_ntd: maleList599, price_ntd: maleList599 },
        },
      },
    })
    expect(r.finalAmountNtd).toBe(599)
  })

  it('B 5折 promo', () => {
    const r = computeMaleMembershipCheckoutAmount({ pricing: pricingAt5Tenths })
    expect(malePromo5Tenths).toBe(299)
    expect(r.finalAmountNtd).toBe(299)
  })

  it('C 5折 + 48h $200 → NT$99 floor', () => {
    const r = computeMaleMembershipCheckoutAmount({
      pricing: pricingAt5Tenths,
      userCoupon: coupon48h,
    })
    expect(r.finalAmountNtd).toBe(99)
  })

  it('D 7d 三折 ignores promo → 179', () => {
    const r = computeMaleMembershipCheckoutAmount({
      pricing: pricingAt5Tenths,
      userCoupon: coupon7d,
    })
    expect(rawPayRatioTenthsAmountNtd(maleList599, 3)).toBe(179)
    expect(r.finalAmountNtd).toBe(179)
  })
})

describe('48h coupon: no membership discount stacking', () => {
  it('rejects 48h + TSVIP', () => {
    expectStackingConflict(() =>
      computeMaleMembershipCheckoutAmount({
        pricing: pricingAt7TenthsProduction,
        membershipDiscount: { code: 'TSVIP', discountNtd: 100, finalPriceNtd: 319 },
        userCoupon: coupon48h,
      }),
    )
  })

  it('rejects 48h + TSFB', () => {
    expectStackingConflict(() =>
      computeMaleMembershipCheckoutAmount({
        pricing: pricingAt5Tenths,
        membershipDiscount: { code: 'TSFB', discountNtd: 300, finalPriceNtd: 1 },
        userCoupon: coupon48h,
      }),
    )
  })

  it('rejects 48h + arbitrary membership discount code', () => {
    expectStackingConflict(() =>
      computeMaleMembershipCheckoutAmount({
        pricing: pricingAt5Tenths,
        membershipDiscount: { code: 'PARTNER50', discountNtd: 50, finalPriceNtd: 249 },
        userCoupon: coupon48h,
      }),
    )
  })

  it('uses promoPriceNtd − 200, not post-discount-code running price', () => {
    const r = computeMaleMembershipCheckoutAmount({
      pricing: {
        ...pricingAt5Tenths,
        membership: {
          ...pricingAt5Tenths.membership,
          male: { list_price_ntd: 599, price_ntd: 500 },
        },
      },
      userCoupon: coupon48h,
    })
    expect(r.finalAmountNtd).toBe(300)
  })
})

describe('48h coupon NT$99 floor', () => {
  it('floors calculated 50 to 99', () => {
    const r = computeMaleMembershipCheckoutAmount({
      pricing: {
        ...pricingAt5Tenths,
        membership: {
          ...pricingAt5Tenths.membership,
          male: { list_price_ntd: 599, price_ntd: 250 },
        },
      },
      userCoupon: coupon48h,
    })
    expect(r.finalAmountNtd).toBe(99)
  })

  it('floors negative to 99', () => {
    expect(applyAcquisitionCouponCheckoutFloor(-100)).toBe(99)
    const r = computeMaleMembershipCheckoutAmount({
      pricing: {
        ...pricingAt5Tenths,
        membership: {
          ...pricingAt5Tenths.membership,
          male: { list_price_ntd: 599, price_ntd: 100 },
        },
      },
      userCoupon: coupon48h,
    })
    expect(r.finalAmountNtd).toBe(99)
  })
})

describe('7d coupon', () => {
  it('uses list × 0.30 not promo → 179 at list 599', () => {
    const r = computeMaleMembershipCheckoutAmount({
      pricing: pricingAt5Tenths,
      userCoupon: coupon7d,
    })
    expect(r.finalAmountNtd).toBe(179)
  })

  it('rejects TSVIP stacking', () => {
    expectStackingConflict(() =>
      computeMaleMembershipCheckoutAmount({
        pricing: pricingAt5Tenths,
        membershipDiscount: { code: 'TSVIP', discountNtd: 100, finalPriceNtd: 199 },
        userCoupon: coupon7d,
      }),
    )
  })

  it('rejects TSFB stacking', () => {
    expectStackingConflict(() =>
      computeMaleMembershipCheckoutAmount({
        pricing: pricingAt5Tenths,
        membershipDiscount: { code: 'TSFB', discountNtd: 300, finalPriceNtd: 1 },
        userCoupon: coupon7d,
      }),
    )
  })

  it('applies NT$99 floor when raw ratio below 99', () => {
    const r = computeMaleMembershipCheckoutAmount({
      pricing: {
        ...pricingAt5Tenths,
        membership: {
          ...pricingAt5Tenths.membership,
          male: { list_price_ntd: 300, price_ntd: 150 },
        },
      },
      userCoupon: coupon7d,
    })
    expect(rawPayRatioTenthsAmountNtd(300, 3)).toBe(90)
    expect(r.finalAmountNtd).toBe(99)
  })
})

describe('checkout without acquisition coupon unchanged', () => {
  it('TSVIP on 5折 promo', () => {
    const r = computeMaleMembershipCheckoutAmount({
      pricing: pricingAt5Tenths,
      membershipDiscount: { code: 'TSVIP', discountNtd: 100, finalPriceNtd: 199 },
    })
    expect(r.finalAmountNtd).toBe(199)
  })

  it('TSFB on 5折 promo', () => {
    const r = computeMaleMembershipCheckoutAmount({
      pricing: pricingAt5Tenths,
      membershipDiscount: { code: 'TSFB', discountNtd: 300, finalPriceNtd: 1 },
    })
    expect(r.finalAmountNtd).toBe(1)
  })
})

describe('stripUntrustedCheckoutPriceFields', () => {
  it('removes forged amounts', () => {
    const body: Record<string, unknown> = {
      productType: 'membership',
      amountNtd: 1,
      finalPrice: 1,
    }
    stripUntrustedCheckoutPriceFields(body)
    expect(body.amountNtd).toBeUndefined()
    expect(body.productType).toBe('membership')
  })
})
