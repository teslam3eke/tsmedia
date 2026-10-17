import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

describe('acquisition coupon lifecycle phase 1 wiring', () => {
  it('cron handler delegates to lifecycle runner', () => {
    const src = fs.readFileSync(
      path.join(root, 'api/cron-acquisition-coupon-lifecycle.ts'),
      'utf8',
    )
    expect(src).toMatch(/runAcquisitionCouponLifecycleCron/)
    expect(src).toMatch(/CRON_SECRET/)
  })

  it('runner uses issue_acquisition_coupon_entitlement_v2 only', () => {
    const src = fs.readFileSync(
      path.join(root, 'api/_utils/acquisitionCouponLifecycleCron.ts'),
      'utf8',
    )
    expect(src).toMatch(/issue_acquisition_coupon_entitlement_v2/)
    expect(src).not.toMatch(/insert into public\.user_coupon_entitlements/i)
    expect(src).toMatch(/acquisition_lifecycle_anchor_at/)
    expect(src).toMatch(/deliverAcquisitionCouponEmailIfNeeded/)
  })

  it('checkout preview API is read-only GET', () => {
    const src = fs.readFileSync(path.join(root, 'api/my-acquisition-coupon-checkout.ts'), 'utf8')
    expect(src).toMatch(/method !== 'GET'/)
    expect(src).toMatch(/buildMyAcquisitionCouponCheckoutPreview/)
  })

  it('paywall passes userCouponEntitlementId to ecpay checkout', () => {
    const src = fs.readFileSync(
      path.join(root, 'src/screens/MembershipPaywallScreen.tsx'),
      'utf8',
    )
    expect(src).toMatch(/fetchAcquisitionCouponAutoApply/)
    expect(src).toMatch(/userCouponEntitlementId: acquisitionAutoApply/)
  })

  it('client does not hardcode acquisition final amounts or campaign priority', () => {
    const paywall = fs.readFileSync(
      path.join(root, 'src/screens/MembershipPaywallScreen.tsx'),
      'utf8',
    )
    const clientCheckout = fs.readFileSync(
      path.join(root, 'src/lib/acquisitionCouponCheckout.ts'),
      'utf8',
    )
    expect(paywall).not.toMatch(/\b179\b|\b219\b/)
    expect(paywall).not.toMatch(/APPROVED_48H_200|APPROVED_7D_30PCT/)
    expect(clientCheckout).not.toMatch(/\b179\b|\b219\b/)
    expect(clientCheckout).not.toMatch(/APPROVED_48H|30PCT/)
  })

  it('auto-apply and checkout both use authoritative server pricing resolver', () => {
    const previewUtil = fs.readFileSync(
      path.join(root, 'api/_utils/myAcquisitionCouponCheckout.ts'),
      'utf8',
    )
    const ecpay = fs.readFileSync(path.join(root, 'api/ecpay-create-order.ts'), 'utf8')
    expect(previewUtil).toMatch(/selectBestAcquisitionCheckoutEntitlement/)
    expect(previewUtil).toMatch(/resolveMaleMembershipCheckout/)
    expect(ecpay).toMatch(/resolveMaleMembershipCheckout/)
  })
})
