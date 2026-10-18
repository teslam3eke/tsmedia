import { describe, expect, it } from 'vitest'

/** migration 162：僅 service_role 可執行（文件／回歸；實際權限在 SQL GRANT） */
export const COUPON_SERVICE_ROLE_ONLY_RPCS = [
  'issue_user_coupon_entitlement_for_service',
  'reserve_user_coupon_for_ecpay_order',
  'release_user_coupon_reservation_for_ecpay',
  'attempt_user_coupon_redemption_for_ecpay_order',
  'reconcile_ecpay_coupon_redemption_for_service',
  'release_stale_user_coupon_reservations',
] as const

/** migration 164：lifecycle issue + email delivery（僅 service_role） */
export const LIFECYCLE_164_SERVICE_ROLE_ONLY_RPCS = [
  'issue_acquisition_coupon_entitlement_v2',
  'user_has_ever_paid_vip_membership',
  'claim_acquisition_coupon_email_delivery',
  'mark_acquisition_coupon_email_sent',
  'release_acquisition_coupon_email_in_flight',
] as const

/** migration 166：registration reminder email delivery（僅 service_role） */
export const REGISTRATION_REMINDER_166_SERVICE_ROLE_ONLY_RPCS = [
  'registration_reminder_eligible_after',
  'claim_registration_reminder_email_delivery',
  'mark_registration_reminder_email_sent',
  'release_registration_reminder_email_in_flight',
] as const

describe('coupon RPC access policy (documented)', () => {
  it('lists acquisition coupon RPCs as service-only', () => {
    expect(COUPON_SERVICE_ROLE_ONLY_RPCS).toContain('issue_user_coupon_entitlement_for_service')
    expect(COUPON_SERVICE_ROLE_ONLY_RPCS).not.toContain('get_public_payment_pricing')
  })

  it('lists registration reminder 166 RPCs as service-only', () => {
    expect(REGISTRATION_REMINDER_166_SERVICE_ROLE_ONLY_RPCS).toContain(
      'claim_registration_reminder_email_delivery',
    )
  })

  it('authenticated must not use issue/reserve/redeem (enforced in migration 162 REVOKE)', () => {
    for (const rpc of [
      'issue_user_coupon_entitlement_for_service',
      'reserve_user_coupon_for_ecpay_order',
      'attempt_user_coupon_redemption_for_ecpay_order',
    ]) {
      expect(COUPON_SERVICE_ROLE_ONLY_RPCS.includes(rpc as (typeof COUPON_SERVICE_ROLE_ONLY_RPCS)[number])).toBe(
        true,
      )
    }
  })
})
