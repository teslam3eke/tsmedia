import { describe, expect, it, vi } from 'vitest'
import {
  isRegistrationReminderStageEligible,
  pickEarliestUnsentEligibleRegistrationReminderStage,
  registrationReminderStageMinAgeMs,
} from './registrationReminderEligibility'
import {
  buildRegistrationReminderEmailContent,
  REGISTRATION_REMINDER_EMAIL_SUBJECT_BY_STAGE,
} from './registrationReminderEmailTemplate'
import { deliverRegistrationReminderEmailIfNeeded } from './deliverRegistrationReminderEmailIfNeeded'
import { computeMaleMembershipCheckoutAmount } from './membershipCheckoutPricing'
import { generalPromoPriceFromListNtd } from './paymentPromoCampaign'
import { resolveMaleMembershipCheckout } from './resolveMaleMembershipCheckout'
import { resolveMaleMembershipDiscount } from './membershipDiscount'
import { MembershipCheckoutPricingError } from './membershipCheckoutPricing'
import { USER_COUPON_CAMPAIGN } from './membershipCheckoutPricing'
import * as userCouponEntitlement from './userCouponEntitlement'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const TSSPE_GO_LIVE_TEST = '2026-01-01T00:00:00.000Z'
const eligibleAfterMs = new Date('2025-06-01T00:00:00.000Z').getTime()

function confirmedAtHoursAgo(hours: number, nowMs: number): string {
  return new Date(nowMs - hours * 3600_000).toISOString()
}

describe('male two-stage registration reminder eligibility', () => {
  const nowMs =
    eligibleAfterMs + registrationReminderStageMinAgeMs(3) + 3600_000

  it('A male +24h → Stage1 eligible', () => {
    const confirmed = confirmedAtHoursAgo(25, nowMs)
    expect(
      isRegistrationReminderStageEligible({
        stage: 1,
        emailConfirmedAt: confirmed,
        eligibleAfterMs,
        nowMs,
        hasAnyVerificationApplication: false,
        hasLegacyVerificationDocsOnly: false,
        lifecycleGender: 'male',
      }),
    ).toBe(true)
  })

  it('B male +48h Stage1 sent → Stage2 eligible', () => {
    const confirmed = confirmedAtHoursAgo(49, nowMs)
    const sent = new Set([1] as const)
    expect(
      pickEarliestUnsentEligibleRegistrationReminderStage({
        sentStages: sent,
        emailConfirmedAt: confirmed,
        eligibleAfterMs,
        nowMs,
        hasAnyVerificationApplication: false,
        hasLegacyVerificationDocsOnly: false,
        lifecycleGender: 'male',
      }),
    ).toBe(2)
  })

  it('C male +72h Stage1+2 sent → Stage3 NOT eligible', () => {
    const confirmed = confirmedAtHoursAgo(73, nowMs)
    expect(
      isRegistrationReminderStageEligible({
        stage: 3,
        emailConfirmedAt: confirmed,
        eligibleAfterMs,
        nowMs,
        hasAnyVerificationApplication: false,
        hasLegacyVerificationDocsOnly: false,
        lifecycleGender: 'male',
      }),
    ).toBe(false)
    const sent = new Set([1, 2] as const)
    expect(
      pickEarliestUnsentEligibleRegistrationReminderStage({
        sentStages: sent,
        emailConfirmedAt: confirmed,
        eligibleAfterMs,
        nowMs,
        hasAnyVerificationApplication: false,
        hasLegacyVerificationDocsOnly: false,
        lifecycleGender: 'male',
      }),
    ).toBeNull()
  })

  it('F female +72h Stage1+2 sent → Stage3 eligible', () => {
    const confirmed = confirmedAtHoursAgo(73, nowMs)
    const sent = new Set([1, 2] as const)
    expect(
      pickEarliestUnsentEligibleRegistrationReminderStage({
        sentStages: sent,
        emailConfirmedAt: confirmed,
        eligibleAfterMs,
        nowMs,
        hasAnyVerificationApplication: false,
        hasLegacyVerificationDocsOnly: false,
        lifecycleGender: 'female',
      }),
    ).toBe(3)
  })

  it('G unknown +72h Stage1+2 sent → Stage3 eligible', () => {
    const confirmed = confirmedAtHoursAgo(73, nowMs)
    const sent = new Set([1, 2] as const)
    expect(
      pickEarliestUnsentEligibleRegistrationReminderStage({
        sentStages: sent,
        emailConfirmedAt: confirmed,
        eligibleAfterMs,
        nowMs,
        hasAnyVerificationApplication: false,
        hasLegacyVerificationDocsOnly: false,
        lifecycleGender: 'unknown',
      }),
    ).toBe(3)
  })
})

describe('registration reminder email templates by gender', () => {
  it('H male Stage2 contains TSSPE and NT$150', () => {
    const c = buildRegistrationReminderEmailContent('https://tsmedia.tw', 2, 'male')
    expect(c.subject).toBe(REGISTRATION_REMINDER_EMAIL_SUBJECT_BY_STAGE[2])
    expect(c.text).toContain('TSSPE')
    expect(c.text).toContain('NT$150')
    expect(c.html).toContain('TSSPE')
  })

  it('I female Stage2 does NOT contain TSSPE', () => {
    const c = buildRegistrationReminderEmailContent('https://tsmedia.tw', 2, 'female')
    expect(c.text).not.toContain('TSSPE')
    expect(c.text).not.toContain('NT$150')
  })

  it('J unknown Stage2 does NOT contain TSSPE', () => {
    const c = buildRegistrationReminderEmailContent('https://tsmedia.tw', 2, 'unknown')
    expect(c.text).not.toContain('TSSPE')
  })

  it('male Stage1 unchanged — no TSSPE', () => {
    const c = buildRegistrationReminderEmailContent('https://tsmedia.tw', 1, 'male')
    expect(c.subject).toBe('你的 tsmedia 申請還差最後一步')
    expect(c.text).not.toContain('TSSPE')
  })
})

describe('male stage2 delivery rows', () => {
  it('1–2 male Stage2 success does not create Stage3 sent row (no tombstone)', async () => {
    const upsert = vi.fn()
    const admin = {
      rpc: vi.fn(async (name: string, args: Record<string, unknown>) => {
        if (name === 'claim_registration_reminder_email_delivery') {
          return { data: { ok: true, user_id: args.p_user_id, reminder_stage: 2 }, error: null }
        }
        if (name === 'mark_registration_reminder_email_sent') return { data: { ok: true }, error: null }
        return { data: null, error: null }
      }),
      from: vi.fn((table: string) => {
        if (table === 'registration_reminder_email_deliveries') {
          return {
            select: vi.fn((cols?: string) => {
              if (cols === 'reminder_stage') {
                return {
                  eq: vi.fn().mockReturnThis(),
                  not: vi.fn().mockResolvedValue({
                    data: [{ reminder_stage: 1 }],
                    error: null,
                  }),
                }
              }
              return {
                eq: vi.fn().mockReturnThis(),
                not: vi.fn().mockReturnThis(),
                upsert,
                insert: upsert,
              }
            }),
            upsert,
            insert: upsert,
          }
        }
        if (table === 'verification_applications') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            limit: vi.fn(async () => ({ data: [], error: null })),
          }
        }
        if (table === 'verification_docs') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            limit: vi.fn(async () => ({ data: [], error: null })),
          }
        }
        return { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), limit: vi.fn() }
      }),
      auth: {
        admin: {
          getUserById: vi.fn(async () => ({
            data: {
              user: {
                email: 'm@example.com',
                email_confirmed_at: confirmedAtHoursAgo(50, Date.now()),
              },
            },
            error: null,
          })),
        },
      },
    } as unknown as Parameters<typeof deliverRegistrationReminderEmailIfNeeded>[0]

    await deliverRegistrationReminderEmailIfNeeded(admin, 'u-m', {
      stage: 2,
      emailConfirmedAt: confirmedAtHoursAgo(50, Date.now()),
      eligibleAfterMs,
      hasAnyVerificationApplication: false,
      hasLegacyVerificationDocsOnly: false,
      lifecycleGender: 'male',
    })
    expect(upsert).not.toHaveBeenCalled()
  })
})

describe('deliver male stage3 guard', () => {
  it('E retry uses same pickEarliest — male stage1+2 sent never picks stage 3', () => {
    const nowMs =
      eligibleAfterMs + registrationReminderStageMinAgeMs(3) + 3600_000
    const confirmed = confirmedAtHoursAgo(73, nowMs)
    expect(
      pickEarliestUnsentEligibleRegistrationReminderStage({
        sentStages: new Set([1, 2]),
        emailConfirmedAt: confirmed,
        eligibleAfterMs,
        nowMs,
        hasAnyVerificationApplication: false,
        hasLegacyVerificationDocsOnly: false,
        lifecycleGender: 'male',
      }),
    ).toBeNull()
  })

  it('D direct deliver male Stage3 → skipped', async () => {
    const admin = {
      rpc: vi.fn(),
      from: vi.fn(),
      auth: { admin: { getUserById: vi.fn() } },
    } as unknown as Parameters<typeof deliverRegistrationReminderEmailIfNeeded>[0]

    const outcome = await deliverRegistrationReminderEmailIfNeeded(admin, 'user-1', {
      stage: 3,
      emailConfirmedAt: confirmedAtHoursAgo(80, Date.now()),
      eligibleAfterMs,
      hasAnyVerificationApplication: false,
      hasLegacyVerificationDocsOnly: false,
      lifecycleGender: 'male',
    })
    expect(outcome).toBe('skipped')
    expect(admin.rpc).not.toHaveBeenCalled()
  })
})

function mockAdminForTsspe(opts: {
  stage2SentAt: string | null
  paid: boolean
}) {
  const from = vi.fn((table: string) => {
    if (table === 'registration_reminder_email_deliveries') {
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: opts.stage2SentAt ? { sent_at: opts.stage2SentAt } : null,
                error: null,
              }),
            }),
          }),
        }),
      }
    }
    return { select: vi.fn() }
  })
  const rpc = vi.fn(async (name: string) => {
    if (name === 'user_has_ever_paid_vip_membership') {
      return { data: opts.paid, error: null }
    }
    return { data: null, error: null }
  })
  return { from, rpc } as unknown as Parameters<typeof resolveMaleMembershipCheckout>[0]
}

const maleList599 = 599
const promo419 = generalPromoPriceFromListNtd(maleList599, 7)
const pricing7 = {
  promo: { id: 'y', label: '7折', discount_tenths: 7, ends_at: '', product_keys: ['all'] },
  membership: {
    male: { list_price_ntd: maleList599, price_ntd: promo419 },
    female: { list_price_ntd: 299, price_ntd: 209 },
  },
  packs: {},
}

const approvedMaleProfile = {
  gender: 'male',
  verification_status: 'approved',
  account_status: 'active',
}

describe('TSSPE checkout eligibility', () => {
  it('K TSSPE eligible → discount 150 on promo base', async () => {
    const admin = mockAdminForTsspe({
      stage2SentAt: '2026-02-01T00:00:00.000Z',
      paid: false,
    })
    const r = await resolveMaleMembershipCheckout(admin, {
      userId: 'u1',
      pricing: pricing7,
      membershipDiscountCodeRaw: 'TSSPE',
      checkoutProfile: approvedMaleProfile,
      tsspeGoLiveOverrideIso: TSSPE_GO_LIVE_TEST,
    })
    expect(r.amountNtd).toBe(269)
    expect(r.membershipDiscountCode).toBe('TSSPE')
  })

  it('R TSSPE + general promo authoritative 599→419→269', () => {
    expect(promo419).toBe(419)
    const breakdown = computeMaleMembershipCheckoutAmount({
      pricing: pricing7,
      membershipDiscount: { code: 'TSSPE', discountNtd: 150, finalPriceNtd: 269 },
    })
    expect(breakdown.finalAmountNtd).toBe(269)
  })

  it('L TSSPE without Stage2 sent → reject', async () => {
    const admin = mockAdminForTsspe({ stage2SentAt: null, paid: false })
    await expect(
      resolveMaleMembershipCheckout(admin, {
        userId: 'u1',
        pricing: pricing7,
        membershipDiscountCodeRaw: 'TSSPE',
        checkoutProfile: approvedMaleProfile,
        tsspeGoLiveOverrideIso: TSSPE_GO_LIVE_TEST,
      }),
    ).rejects.toMatchObject({ code: 'TSSPE_NOT_ELIGIBLE' })
  })

  it('M TSSPE Stage2 sent before go-live → reject', async () => {
    const admin = mockAdminForTsspe({
      stage2SentAt: '2025-12-01T00:00:00.000Z',
      paid: false,
    })
    await expect(
      resolveMaleMembershipCheckout(admin, {
        userId: 'u1',
        pricing: pricing7,
        membershipDiscountCodeRaw: 'TSSPE',
        checkoutProfile: approvedMaleProfile,
        tsspeGoLiveOverrideIso: TSSPE_GO_LIVE_TEST,
      }),
    ).rejects.toMatchObject({ code: 'TSSPE_NOT_ELIGIBLE' })
  })

  it('N TSSPE female → reject', async () => {
    const admin = mockAdminForTsspe({ stage2SentAt: '2026-02-01T00:00:00.000Z', paid: false })
    await expect(
      resolveMaleMembershipCheckout(admin, {
        userId: 'u1',
        pricing: pricing7,
        membershipDiscountCodeRaw: 'TSSPE',
        checkoutProfile: {
          gender: 'female',
          verification_status: 'approved',
          account_status: 'active',
        },
        tsspeGoLiveOverrideIso: TSSPE_GO_LIVE_TEST,
      }),
    ).rejects.toMatchObject({ code: 'TSSPE_NOT_ELIGIBLE' })
  })

  it('O TSSPE not approved → reject', async () => {
    const admin = mockAdminForTsspe({ stage2SentAt: '2026-02-01T00:00:00.000Z', paid: false })
    await expect(
      resolveMaleMembershipCheckout(admin, {
        userId: 'u1',
        pricing: pricing7,
        membershipDiscountCodeRaw: 'TSSPE',
        checkoutProfile: {
          gender: 'male',
          verification_status: 'pending',
          account_status: 'active',
        },
        tsspeGoLiveOverrideIso: TSSPE_GO_LIVE_TEST,
      }),
    ).rejects.toMatchObject({ code: 'TSSPE_NOT_ELIGIBLE' })
  })

  it('P TSSPE already paid VIP → reject', async () => {
    const admin = mockAdminForTsspe({ stage2SentAt: '2026-02-01T00:00:00.000Z', paid: true })
    await expect(
      resolveMaleMembershipCheckout(admin, {
        userId: 'u1',
        pricing: pricing7,
        membershipDiscountCodeRaw: 'TSSPE',
        checkoutProfile: approvedMaleProfile,
        tsspeGoLiveOverrideIso: TSSPE_GO_LIVE_TEST,
      }),
    ).rejects.toMatchObject({ code: 'TSSPE_NOT_ELIGIBLE' })
  })

  it('Q TSSPE + acquisition coupon → COUPON_STACKING_CONFLICT', async () => {
    vi.spyOn(userCouponEntitlement, 'loadUserCouponEntitlementForCheckout').mockResolvedValue({
      entitlementId: '00000000-0000-0000-0000-000000000099',
      campaignKey: USER_COUPON_CAMPAIGN.APPROVED_48H_200,
      discountKind: 'fixed_amount',
      discountValue: 200,
      stackingPolicy: 'stack_on_promo_price',
      allowsMembershipDiscountCode: false,
      eligibleProductKey: 'membership_male',
    })
    const admin = mockAdminForTsspe({
      stage2SentAt: '2026-02-01T00:00:00.000Z',
      paid: false,
    })
    await expect(
      resolveMaleMembershipCheckout(admin, {
        userId: 'u1',
        pricing: pricing7,
        membershipDiscountCodeRaw: 'TSSPE',
        userCouponEntitlementIdRaw: '00000000-0000-0000-0000-000000000099',
        checkoutProfile: approvedMaleProfile,
        tsspeGoLiveOverrideIso: TSSPE_GO_LIVE_TEST,
      }),
    ).rejects.toMatchObject({ code: 'COUPON_STACKING_CONFLICT' })
  })
})

describe('TSVIP / TSFB unchanged', () => {
  it('S TSVIP path rejects TSSPE code at DB resolver', async () => {
    const admin = { from: vi.fn(), rpc: vi.fn() } as unknown as Parameters<
      typeof resolveMaleMembershipDiscount
    >[0]
    await expect(resolveMaleMembershipDiscount(admin, 'TSSPE', 419)).rejects.toThrow(
      'INVALID_MEMBERSHIP_DISCOUNT_CODE',
    )
  })

  it('T TSFB not routed through TSSPE branch', async () => {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)))
    const src = fs.readFileSync(path.join(root, 'resolveMaleMembershipCheckout.ts'), 'utf8')
    expect(src).toMatch(/resolveMaleMembershipDiscount/)
    expect(src).toMatch(/isTsspeMembershipDiscountCode/)
  })
})

describe('Purchase CAPI unchanged', () => {
  it('U still uses ecpay_orders.amount_ntd', () => {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)))
    const capi = fs.readFileSync(path.join(root, 'ecpayMetaCapiPurchase.ts'), 'utf8')
    expect(capi).toMatch(/valueNtd: row\.amount_ntd/)
  })
})

describe('checkout revalidates after preview', () => {
  it('18 preview path separate from resolveMaleMembershipCheckout (checkout still calls eligibility)', async () => {
    const admin = mockAdminForTsspe({
      stage2SentAt: '2026-02-01T00:00:00.000Z',
      paid: false,
    })
    await resolveMaleMembershipCheckout(admin, {
      userId: 'u1',
      pricing: pricing7,
      membershipDiscountCodeRaw: 'TSSPE',
      checkoutProfile: approvedMaleProfile,
      tsspeGoLiveOverrideIso: TSSPE_GO_LIVE_TEST,
    })
    expect(admin.rpc).toHaveBeenCalledWith('user_has_ever_paid_vip_membership', {
      p_user_id: 'u1',
    })
  })
})

describe('acquisition coupon campaign constants', () => {
  it('defines acquisition keys for stacking tests', () => {
    expect(USER_COUPON_CAMPAIGN.APPROVED_48H_200).toBeTruthy()
  })
})
