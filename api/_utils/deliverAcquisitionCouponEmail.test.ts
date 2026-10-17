import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { USER_COUPON_CAMPAIGN } from './membershipCheckoutPricing'
import { deliverAcquisitionCouponEmailIfNeeded } from './deliverAcquisitionCouponEmailIfNeeded'

function mockAdmin(overrides: {
  entitlement?: Record<string, unknown> | null
  paid?: boolean
  claim?: unknown
  email?: string | null
}): SupabaseClient {
  const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
    if (name === 'user_has_ever_paid_vip_membership') {
      return { data: overrides.paid === true, error: null }
    }
    if (name === 'claim_acquisition_coupon_email_delivery') {
      return { data: overrides.claim ?? null, error: null }
    }
    if (name === 'mark_acquisition_coupon_email_sent') {
      return { data: { ok: true }, error: null }
    }
    if (name === 'release_acquisition_coupon_email_in_flight') {
      return { data: { ok: true }, error: null }
    }
    return { data: null, error: null }
  })

  const from = vi.fn(() => ({
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn(async () => ({
      data: overrides.entitlement ?? null,
      error: null,
    })),
  }))

  return {
    rpc,
    from,
    auth: {
      admin: {
        getUserById: vi.fn(async () => ({
          data: { user: overrides.email ? { email: overrides.email } : null },
          error: null,
        })),
      },
    },
  } as unknown as SupabaseClient
}

describe('deliverAcquisitionCouponEmailIfNeeded', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ id: 'resend-1' }), { status: 200 })),
    )
    process.env.RESEND_API_KEY = 're_test'
    process.env.APPROVAL_EMAIL_FROM = 'tsmedia <noreply@tsmedia.tw>'
  })

  it('does not claim when coupon expired', async () => {
    const admin = mockAdmin({
      entitlement: {
        id: 'ent1',
        user_id: 'u1',
        campaign_key: USER_COUPON_CAMPAIGN.APPROVED_48H_200,
        expires_at: '2020-01-01T00:00:00.000Z',
        status: 'available',
      },
      paid: false,
    })
    await deliverAcquisitionCouponEmailIfNeeded(admin, 'ent1')
    expect(admin.rpc).not.toHaveBeenCalledWith(
      'claim_acquisition_coupon_email_delivery',
      expect.anything(),
    )
  })

  it('does not claim when user paid', async () => {
    const admin = mockAdmin({
      entitlement: {
        id: 'ent1',
        user_id: 'u1',
        campaign_key: USER_COUPON_CAMPAIGN.APPROVED_48H_200,
        expires_at: '2099-01-01T00:00:00.000Z',
        status: 'available',
      },
      paid: true,
    })
    await deliverAcquisitionCouponEmailIfNeeded(admin, 'ent1')
    expect(admin.rpc).not.toHaveBeenCalledWith(
      'claim_acquisition_coupon_email_delivery',
      expect.anything(),
    )
  })

  it('marks sent on successful resend', async () => {
    const admin = mockAdmin({
      entitlement: {
        id: 'ent1',
        user_id: 'u1',
        campaign_key: USER_COUPON_CAMPAIGN.APPROVED_48H_200,
        expires_at: '2099-01-01T00:00:00.000Z',
        status: 'available',
      },
      paid: false,
      claim: {
        ok: true,
        entitlement_id: 'ent1',
        user_id: 'u1',
        campaign_key: USER_COUPON_CAMPAIGN.APPROVED_48H_200,
      },
      email: 'user@example.com',
    })
    await deliverAcquisitionCouponEmailIfNeeded(admin, 'ent1')
    expect(admin.rpc).toHaveBeenCalledWith('mark_acquisition_coupon_email_sent', {
      p_entitlement_id: 'ent1',
    })
  })
})
