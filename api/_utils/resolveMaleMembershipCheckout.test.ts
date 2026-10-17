import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { resolveMaleMembershipCheckout } from './resolveMaleMembershipCheckout'
import { MembershipCheckoutPricingError } from './membershipCheckoutPricing'
import { USER_COUPON_CAMPAIGN } from './membershipCheckoutPricing'

const loadUserCouponEntitlementForCheckout = vi.fn()
const resolveMaleMembershipDiscount = vi.fn()

vi.mock('./userCouponEntitlement.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./userCouponEntitlement.js')>()
  return {
    ...actual,
    loadUserCouponEntitlementForCheckout: (...args: unknown[]) =>
      loadUserCouponEntitlementForCheckout(...args),
  }
})

vi.mock('./membershipDiscount.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./membershipDiscount.js')>()
  return {
    ...actual,
    resolveMaleMembershipDiscount: (...args: unknown[]) => resolveMaleMembershipDiscount(...args),
  }
})

const admin = {} as SupabaseClient

const pricing419 = {
  promo: { id: 'x', label: '7折', discount_tenths: 7, ends_at: '', product_keys: ['all'] },
  membership: {
    male: { list_price_ntd: 599, price_ntd: 419 },
    female: { list_price_ntd: 299, price_ntd: 209 },
  },
  packs: {},
}

const coupon48hLoaded = {
  entitlementId: 'ent-48h',
  campaignKey: USER_COUPON_CAMPAIGN.APPROVED_48H_200,
  discountKind: 'fixed_amount' as const,
  discountValue: 200,
  stackingPolicy: 'stack_on_promo_price' as const,
  allowsMembershipDiscountCode: false,
  eligibleProductKey: 'membership_male',
}

beforeEach(() => {
  loadUserCouponEntitlementForCheckout.mockReset()
  resolveMaleMembershipDiscount.mockReset()
})

describe('resolveMaleMembershipCheckout stacking guard', () => {
  it('48h only → 219 at 7折 promo', async () => {
    loadUserCouponEntitlementForCheckout.mockResolvedValue(coupon48hLoaded)

    const r = await resolveMaleMembershipCheckout(admin, {
      userId: 'u1',
      pricing: pricing419,
      userCouponEntitlementIdRaw: 'ent-48h',
    })

    expect(r.amountNtd).toBe(219)
    expect(r.membershipDiscountCode).toBeNull()
    expect(resolveMaleMembershipDiscount).not.toHaveBeenCalled()
  })

  it('48h + TSVIP → COUPON_STACKING_CONFLICT before DB discount lookup', async () => {
    loadUserCouponEntitlementForCheckout.mockResolvedValue(coupon48hLoaded)

    await expect(
      resolveMaleMembershipCheckout(admin, {
        userId: 'u1',
        pricing: pricing419,
        userCouponEntitlementIdRaw: 'ent-48h',
        membershipDiscountCodeRaw: 'TSVIP',
      }),
    ).rejects.toMatchObject({
      code: 'COUPON_STACKING_CONFLICT',
    } satisfies Partial<MembershipCheckoutPricingError>)

    expect(resolveMaleMembershipDiscount).not.toHaveBeenCalled()
  })
})
