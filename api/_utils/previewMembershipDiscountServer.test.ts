import { describe, expect, it, vi } from 'vitest'
import { previewMembershipDiscountAuthoritative } from './previewMembershipDiscountServer'
import { generalPromoPriceFromListNtd } from './paymentPromoCampaign'

const TSSPE_GO_LIVE_TEST = '2026-01-01T00:00:00.000Z'
const maleList599 = 599
const promo419 = generalPromoPriceFromListNtd(maleList599, 7)

const approvedMale = {
  gender: 'male',
  verification_status: 'approved',
  account_status: 'active',
}

const pricing7 = {
  promo: { id: 'y', label: '7折', discount_tenths: 7, ends_at: '', product_keys: ['all'] },
  membership: {
    male: { list_price_ntd: maleList599, price_ntd: promo419 },
    female: { list_price_ntd: 299, price_ntd: 209 },
  },
  packs: {},
}

function mockAdminTsspe(opts: { stage2SentAt: string | null; paid: boolean }) {
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
        upsert: vi.fn(() => {
          throw new Error('preview must not write deliveries')
        }),
        insert: vi.fn(() => {
          throw new Error('preview must not write deliveries')
        }),
        update: vi.fn(() => {
          throw new Error('preview must not write deliveries')
        }),
      }
    }
    throw new Error(`unexpected table ${table}`)
  })
  const rpc = vi.fn(async (name: string) => {
    if (name === 'user_has_ever_paid_vip_membership') {
      return { data: opts.paid, error: null }
    }
    if (name === 'get_public_payment_pricing') {
      return { data: pricing7, error: null }
    }
    throw new Error(`unexpected rpc ${name}`)
  })
  return { from, rpc } as unknown as Parameters<typeof previewMembershipDiscountAuthoritative>[0]
}

describe('previewMembershipDiscountAuthoritative — TSSPE', () => {
  const userRpc = { rpc: vi.fn() } as unknown as Parameters<
    typeof previewMembershipDiscountAuthoritative
  >[1]

  it('8–10 eligible TSSPE preview valid, discount 150, promo minus 150', async () => {
    const admin = mockAdminTsspe({
      stage2SentAt: '2026-02-01T00:00:00.000Z',
      paid: false,
    })
    const r = await previewMembershipDiscountAuthoritative(admin, userRpc, {
      userId: 'u1',
      codeRaw: 'TSSPE',
      profile: approvedMale,
      tsspeGoLiveOverrideIso: TSSPE_GO_LIVE_TEST,
    })
    expect(r.ok).toBe(true)
    expect(r.benefit).toBe('male_discount')
    expect(r.discount_ntd).toBe(150)
    expect(r.base_price_ntd).toBe(419)
    expect(r.final_price_ntd).toBe(269)
  })

  it('11 TSSPE no Stage2 sent → invalid', async () => {
    const admin = mockAdminTsspe({ stage2SentAt: null, paid: false })
    const r = await previewMembershipDiscountAuthoritative(admin, userRpc, {
      userId: 'u1',
      codeRaw: 'TSSPE',
      profile: approvedMale,
      tsspeGoLiveOverrideIso: TSSPE_GO_LIVE_TEST,
    })
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('invalid_code')
  })

  it('12 TSSPE Stage2 before go-live → invalid', async () => {
    const admin = mockAdminTsspe({
      stage2SentAt: '2025-12-01T00:00:00.000Z',
      paid: false,
    })
    const r = await previewMembershipDiscountAuthoritative(admin, userRpc, {
      userId: 'u1',
      codeRaw: 'TSSPE',
      profile: approvedMale,
      tsspeGoLiveOverrideIso: TSSPE_GO_LIVE_TEST,
    })
    expect(r.ok).toBe(false)
  })

  it('13 TSSPE female → invalid', async () => {
    const admin = mockAdminTsspe({
      stage2SentAt: '2026-02-01T00:00:00.000Z',
      paid: false,
    })
    const r = await previewMembershipDiscountAuthoritative(admin, userRpc, {
      userId: 'u1',
      codeRaw: 'TSSPE',
      profile: {
        gender: 'female',
        verification_status: 'approved',
        account_status: 'active',
      },
      tsspeGoLiveOverrideIso: TSSPE_GO_LIVE_TEST,
    })
    expect(r.ok).toBe(false)
  })

  it('14 TSSPE not approved → invalid', async () => {
    const admin = mockAdminTsspe({
      stage2SentAt: '2026-02-01T00:00:00.000Z',
      paid: false,
    })
    const r = await previewMembershipDiscountAuthoritative(admin, userRpc, {
      userId: 'u1',
      codeRaw: 'TSSPE',
      profile: {
        gender: 'male',
        verification_status: 'pending',
        account_status: 'active',
      },
      tsspeGoLiveOverrideIso: TSSPE_GO_LIVE_TEST,
    })
    expect(r.ok).toBe(false)
  })

  it('15 TSSPE already paid → invalid', async () => {
    const admin = mockAdminTsspe({
      stage2SentAt: '2026-02-01T00:00:00.000Z',
      paid: true,
    })
    const r = await previewMembershipDiscountAuthoritative(admin, userRpc, {
      userId: 'u1',
      codeRaw: 'TSSPE',
      profile: approvedMale,
      tsspeGoLiveOverrideIso: TSSPE_GO_LIVE_TEST,
    })
    expect(r.ok).toBe(false)
  })

  it('16 TSSPE go-live missing → invalid', async () => {
    vi.stubEnv('TSSPE_GO_LIVE', '')
    const admin = mockAdminTsspe({
      stage2SentAt: '2026-02-01T00:00:00.000Z',
      paid: false,
    })
    const r = await previewMembershipDiscountAuthoritative(admin, userRpc, {
      userId: 'u1',
      codeRaw: 'TSSPE',
      profile: approvedMale,
    })
    expect(r.ok).toBe(false)
    vi.unstubAllEnvs()
  })

  it('17 preview does not write DB (no upsert/insert)', async () => {
    const admin = mockAdminTsspe({
      stage2SentAt: '2026-02-01T00:00:00.000Z',
      paid: false,
    })
    await previewMembershipDiscountAuthoritative(admin, userRpc, {
      userId: 'u1',
      codeRaw: 'TSSPE',
      profile: approvedMale,
      tsspeGoLiveOverrideIso: TSSPE_GO_LIVE_TEST,
    })
    const from = admin.from as ReturnType<typeof vi.fn>
    const deliveries = from.mock.results[0]?.value
    expect(deliveries?.upsert).not.toHaveBeenCalled()
    expect(deliveries?.insert).not.toHaveBeenCalled()
  })
})

describe('previewMembershipDiscountAuthoritative — TSVIP / TSFB delegate RPC', () => {
  it('19–20 TSVIP preview delegates to user RPC unchanged', async () => {
    const admin = { from: vi.fn(), rpc: vi.fn() } as unknown as Parameters<
      typeof previewMembershipDiscountAuthoritative
    >[0]
    const userRpc = {
      rpc: vi.fn().mockResolvedValue({
        data: {
          ok: true,
          benefit: 'male_discount',
          code: 'TSVIP',
          discount_ntd: 100,
          base_price_ntd: 419,
          final_price_ntd: 319,
        },
        error: null,
      }),
    } as unknown as Parameters<typeof previewMembershipDiscountAuthoritative>[1]

    const r = await previewMembershipDiscountAuthoritative(admin, userRpc, {
      userId: 'u1',
      codeRaw: 'TSVIP',
      profile: approvedMale,
    })
    expect(userRpc.rpc).toHaveBeenCalledWith('preview_membership_discount_code', {
      p_code: 'TSVIP',
    })
    expect(r.ok).toBe(true)
    expect(r.code).toBe('TSVIP')
    expect(admin.from).not.toHaveBeenCalled()
  })
})
