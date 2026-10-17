import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { USER_COUPON_CAMPAIGN } from './membershipCheckoutPricing'
import { generalPromoPriceFromListNtd } from './paymentPromoCampaign'
import {
  acquisitionCouponDisplayLabel,
  filterEligibleAcquisitionEntitlements,
  pickLowestFinalAmountAcquisitionEntitlement,
  selectBestAcquisitionCheckoutEntitlement,
} from './myAcquisitionCouponCheckout'

const loadUserCouponEntitlementForCheckout = vi.fn()

vi.mock('./userCouponEntitlement.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./userCouponEntitlement.js')>()
  return {
    ...actual,
    loadUserCouponEntitlementForCheckout: (...args: unknown[]) =>
      loadUserCouponEntitlementForCheckout(...args),
  }
})

const admin = {} as SupabaseClient
const now = Date.parse('2026-06-10T12:00:00+08:00')

const maleList599 = 599
const malePromo7Tenths = generalPromoPriceFromListNtd(maleList599, 7)
const malePromo5Tenths = generalPromoPriceFromListNtd(maleList599, 5)

const pricingProduction7Tenths = {
  promo: { id: 'y', label: '7折', discount_tenths: 7, ends_at: '', product_keys: ['all'] },
  membership: {
    male: { list_price_ntd: maleList599, price_ntd: malePromo7Tenths },
    female: { list_price_ntd: 299, price_ntd: 209 },
  },
  packs: {},
}

const pricingAlt5Tenths = {
  promo: { id: 'x', label: '5折', discount_tenths: 5, ends_at: '', product_keys: ['all'] },
  membership: {
    male: { list_price_ntd: maleList599, price_ntd: malePromo5Tenths },
    female: { list_price_ntd: 299, price_ntd: 149 },
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

const coupon7dLoaded = {
  entitlementId: 'ent-7d',
  campaignKey: USER_COUPON_CAMPAIGN.APPROVED_7D_30PCT,
  discountKind: 'pay_ratio_tenths' as const,
  discountValue: 3,
  stackingPolicy: 'replace_promo_use_list_price' as const,
  allowsMembershipDiscountCode: false,
  eligibleProductKey: 'membership_male',
}

beforeEach(() => {
  loadUserCouponEntitlementForCheckout.mockReset()
})

describe('filterEligibleAcquisitionEntitlements', () => {
  it('ignores expired, reserved, and redeemed', () => {
    const rows = filterEligibleAcquisitionEntitlements(
      [
        {
          id: 'expired',
          campaign_key: USER_COUPON_CAMPAIGN.APPROVED_48H_200,
          expires_at: '2026-06-09T12:00:00+08:00',
          status: 'available',
        },
        {
          id: 'reserved',
          campaign_key: USER_COUPON_CAMPAIGN.APPROVED_7D_30PCT,
          expires_at: '2026-06-12T12:00:00+08:00',
          status: 'reserved',
        },
        {
          id: 'redeemed',
          campaign_key: USER_COUPON_CAMPAIGN.APPROVED_48H_200,
          expires_at: '2026-06-12T12:00:00+08:00',
          status: 'redeemed',
        },
      ],
      now,
    )
    expect(rows).toHaveLength(0)
  })
})

describe('pickLowestFinalAmountAcquisitionEntitlement', () => {
  it('equal amount → earlier expires_at', () => {
    const picked = pickLowestFinalAmountAcquisitionEntitlement([
      {
        row: {
          id: 'later',
          campaign_key: USER_COUPON_CAMPAIGN.APPROVED_7D_30PCT,
          expires_at: '2026-06-12T12:00:00+08:00',
          status: 'available',
        },
        finalAmountNtd: 179,
        campaignKey: USER_COUPON_CAMPAIGN.APPROVED_7D_30PCT,
        entitlementId: 'later',
      },
      {
        row: {
          id: 'sooner',
          campaign_key: USER_COUPON_CAMPAIGN.APPROVED_48H_200,
          expires_at: '2026-06-11T12:00:00+08:00',
          status: 'available',
        },
        finalAmountNtd: 179,
        campaignKey: USER_COUPON_CAMPAIGN.APPROVED_48H_200,
        entitlementId: 'sooner',
      },
    ])
    expect(picked?.entitlementId).toBe('sooner')
  })
})

describe('selectBestAcquisitionCheckoutEntitlement (authoritative resolve)', () => {
  const row48 = {
    id: 'ent-48h',
    campaign_key: USER_COUPON_CAMPAIGN.APPROVED_48H_200,
    expires_at: '2026-06-11T12:00:00+08:00',
    status: 'available',
  }
  const row7d = {
    id: 'ent-7d',
    campaign_key: USER_COUPON_CAMPAIGN.APPROVED_7D_30PCT,
    expires_at: '2026-06-12T12:00:00+08:00',
    status: 'available',
  }

  it('1. only 48h available → 48h', async () => {
    loadUserCouponEntitlementForCheckout.mockImplementation(async (_a, _u, entId) => {
      if (entId === 'ent-48h') return { ...coupon48hLoaded, entitlementId: 'ent-48h' }
      return null
    })

    const best = await selectBestAcquisitionCheckoutEntitlement(
      admin,
      'u1',
      pricingProduction7Tenths,
      [row48],
      now,
    )
    expect(best?.campaignKey).toBe(USER_COUPON_CAMPAIGN.APPROVED_48H_200)
    expect(best?.finalAmountNtd).toBe(219)
  })

  it('2. only 7d available → 7d', async () => {
    loadUserCouponEntitlementForCheckout.mockImplementation(async (_a, _u, entId) => {
      if (entId === 'ent-7d') return { ...coupon7dLoaded, entitlementId: 'ent-7d' }
      return null
    })

    const best = await selectBestAcquisitionCheckoutEntitlement(
      admin,
      'u1',
      pricingProduction7Tenths,
      [row7d],
      now,
    )
    expect(best?.campaignKey).toBe(USER_COUPON_CAMPAIGN.APPROVED_7D_30PCT)
    expect(best?.finalAmountNtd).toBe(179)
  })

  it('3. both available at production pricing → 7d (179 < 219)', async () => {
    loadUserCouponEntitlementForCheckout.mockImplementation(async (_a, _u, entId) => {
      if (entId === 'ent-48h') return { ...coupon48hLoaded, entitlementId: 'ent-48h' }
      if (entId === 'ent-7d') return { ...coupon7dLoaded, entitlementId: 'ent-7d' }
      return null
    })

    const best = await selectBestAcquisitionCheckoutEntitlement(
      admin,
      'u1',
      pricingProduction7Tenths,
      [row48, row7d],
      now,
    )
    expect(best?.entitlementId).toBe('ent-7d')
    expect(best?.finalAmountNtd).toBe(179)
  })

  it('4. alternate promo pricing → 48h when its final amount is lower', async () => {
    loadUserCouponEntitlementForCheckout.mockImplementation(async (_a, _u, entId) => {
      if (entId === 'ent-48h') return { ...coupon48hLoaded, entitlementId: 'ent-48h' }
      if (entId === 'ent-7d') return { ...coupon7dLoaded, entitlementId: 'ent-7d' }
      return null
    })

    const best = await selectBestAcquisitionCheckoutEntitlement(
      admin,
      'u1',
      pricingAlt5Tenths,
      [row48, row7d],
      now,
    )
    expect(best?.entitlementId).toBe('ent-48h')
    expect(best?.finalAmountNtd).toBeLessThan(179)
  })
})

describe('acquisitionCouponDisplayLabel', () => {
  it('labels campaigns in zh-TW', () => {
    expect(acquisitionCouponDisplayLabel(USER_COUPON_CAMPAIGN.APPROVED_48H_200)).toContain(
      '$200',
    )
    expect(acquisitionCouponDisplayLabel(USER_COUPON_CAMPAIGN.APPROVED_7D_30PCT)).toContain('3 折')
  })
})
