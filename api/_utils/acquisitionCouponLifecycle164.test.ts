import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  COUPON_SERVICE_ROLE_ONLY_RPCS,
  LIFECYCLE_164_SERVICE_ROLE_ONLY_RPCS,
} from './couponServiceRpcAccess.test'
import {
  Lifecycle164Simulator,
  LIFECYCLE_CAMPAIGN_48H,
  LIFECYCLE_CAMPAIGN_7D,
  lifecycleWindowMet,
} from './acquisitionCouponLifecycle164Spec'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const migration164 = fs.readFileSync(
  path.join(root, 'supabase/migrations/164_acquisition_coupon_lifecycle.sql'),
  'utf8',
)

const anchor = new Date('2026-06-01T12:00:00+08:00').getTime()
const day2 = anchor + 48 * 60 * 60 * 1000
const day7 = anchor + 7 * 24 * 60 * 60 * 1000

function maleUnpaid(userId: string, everPaid = false): void {
  const sim = sharedSim
  sim.upsertProfile({
    userId,
    gender: 'male',
    verificationStatus: 'approved',
    anchorAtMs: anchor,
    everPaidVip: everPaid,
  })
}

let sharedSim: Lifecycle164Simulator

describe('migration 164 file guards', () => {
  it('defines unique user+campaign and service_role grants', () => {
    expect(migration164).toMatch(/user_coupon_entitlements_user_campaign_uidx/)
    expect(migration164).toMatch(/issue_acquisition_coupon_entitlement_v2/)
    expect(migration164).toMatch(
      /revoke all on function public\.issue_acquisition_coupon_entitlement_v2/u,
    )
    expect(migration164).toMatch(/grant execute on function public\.issue_acquisition_coupon_entitlement_v2/u)
    expect(migration164).not.toMatch(
      /update\s+public\.profiles[\s\S]*set[\s\S]*acquisition_lifecycle_anchor_at\s*=/i,
    )
  })

  it('includes newebpay in paid membership helper', () => {
    expect(migration164).toMatch(/newebpay_orders/)
    expect(migration164).toMatch(/user_has_ever_paid_vip_membership/)
  })
})

describe('lifecycle issue v2 (spec simulator)', () => {
  beforeEach(() => {
    sharedSim = new Lifecycle164Simulator()
  })

  it('1. duplicate 48h issue returns same entitlement', () => {
    maleUnpaid('u1')
    const a = sharedSim.issueV2('u1', LIFECYCLE_CAMPAIGN_48H, day2 + 1000)
    const b = sharedSim.issueV2('u1', LIFECYCLE_CAMPAIGN_48H, day2 + 999_000)
    expect(a.ok && b.ok && a.entitlement.id === b.entitlement.id).toBe(true)
    expect(a.ok && b.ok && a.entitlement.issuedAtMs === b.entitlement.issuedAtMs).toBe(true)
    expect(a.ok && b.ok && a.entitlement.expiresAtMs === b.entitlement.expiresAtMs).toBe(true)
    expect(b.ok && b.alreadyExisted).toBe(true)
  })

  it('2. duplicate 7d issue returns same entitlement', () => {
    maleUnpaid('u2')
    const a = sharedSim.issueV2('u2', LIFECYCLE_CAMPAIGN_7D, day7 + 1000)
    const b = sharedSim.issueV2('u2', LIFECYCLE_CAMPAIGN_7D, day7 + 500_000)
    expect(a.ok && b.ok && a.entitlement.id === b.entitlement.id).toBe(true)
  })

  it('3. male approved unpaid eligible at day2/day7 windows', () => {
    maleUnpaid('u3')
    expect(lifecycleWindowMet(LIFECYCLE_CAMPAIGN_48H, anchor, day2)).toBe(true)
    expect(lifecycleWindowMet(LIFECYCLE_CAMPAIGN_7D, anchor, day7)).toBe(true)
    expect(sharedSim.issueV2('u3', LIFECYCLE_CAMPAIGN_48H, day2).ok).toBe(true)
  })

  it('4. female reject', () => {
    sharedSim.upsertProfile({
      userId: 'f1',
      gender: 'female',
      verificationStatus: 'approved',
      anchorAtMs: anchor,
      everPaidVip: false,
    })
    const r = sharedSim.issueV2('f1', LIFECYCLE_CAMPAIGN_48H, day2)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('COUPON_MALE_ONLY')
  })

  it('5–7. ever paid rejects (ECPay/TapPay proxy; expired VIP still paid)', () => {
    maleUnpaid('p1', true)
    const r = sharedSim.issueV2('p1', LIFECYCLE_CAMPAIGN_48H, day2)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('COUPON_NOT_FIRST_MEMBERSHIP_PURCHASE')
  })

  it('8. 48h exists does not block 7d issue', () => {
    maleUnpaid('u8')
    sharedSim.issueV2('u8', LIFECYCLE_CAMPAIGN_48H, day2)
    const r7 = sharedSim.issueV2('u8', LIFECYCLE_CAMPAIGN_7D, day7)
    expect(r7.ok).toBe(true)
    if (r7.ok) expect(r7.entitlement.campaignKey).toBe(LIFECYCLE_CAMPAIGN_7D)
  })

  it('9. 48h reserved does not block 7d issue', () => {
    maleUnpaid('u9')
    const r48 = sharedSim.issueV2('u9', LIFECYCLE_CAMPAIGN_48H, day2)
    expect(r48.ok).toBe(true)
    if (r48.ok) r48.entitlement.status = 'reserved'
    expect(sharedSim.issueV2('u9', LIFECYCLE_CAMPAIGN_7D, day7).ok).toBe(true)
  })

  it('10. 48h reconciliation_required does not block 7d issue', () => {
    maleUnpaid('u10')
    const r48 = sharedSim.issueV2('u10', LIFECYCLE_CAMPAIGN_48H, day2)
    expect(r48.ok).toBe(true)
    if (r48.ok) r48.entitlement.status = 'reconciliation_required'
    expect(sharedSim.issueV2('u10', LIFECYCLE_CAMPAIGN_7D, day7).ok).toBe(true)
  })
})

describe('coupon email delivery (spec simulator)', () => {
  beforeEach(() => {
    sharedSim = new Lifecycle164Simulator()
  })

  it('11. claim retry does not double-send after sent', () => {
    maleUnpaid('e1')
    const issued = sharedSim.issueV2('e1', LIFECYCLE_CAMPAIGN_48H, day2)
    expect(issued.ok).toBe(true)
    if (!issued.ok) return
    const id = issued.entitlement.id
    const t0 = day2 + 1000
    expect(sharedSim.claimEmail(id, t0).ok).toBe(true)
    sharedSim.markEmailSent(id, t0 + 1000)
    expect(sharedSim.claimEmail(id, t0 + 2000).reason).toBe('already_sent')
  })
})

describe('service_role-only lifecycle RPCs (documented)', () => {
  it('12. lists 164 mutation RPCs as service-only', () => {
    for (const rpc of LIFECYCLE_164_SERVICE_ROLE_ONLY_RPCS) {
      expect(COUPON_SERVICE_ROLE_ONLY_RPCS.includes(rpc as never)).toBe(false)
      expect(migration164).toMatch(new RegExp(rpc))
    }
    expect(migration164).toMatch(/revoke all on function public\.claim_acquisition_coupon_email_delivery/)
    expect(migration164).toMatch(/revoke all on table public\.acquisition_coupon_email_deliveries from anon, authenticated/)
  })
})
