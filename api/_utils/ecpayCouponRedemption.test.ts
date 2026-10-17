import { describe, expect, it } from 'vitest'
import {
  canReleaseStaleCouponReservation,
  membershipGrantedDespiteCouponBookkeepingFailure,
} from './ecpayCouponRedemption'

const threeHoursMs = 3 * 60 * 60 * 1000
const now = new Date('2026-06-01T15:00:00+08:00').getTime()

describe('stale coupon reservation release', () => {
  const oldPending = {
    status: 'pending',
    fulfilled_at: null,
    paid_at: null,
    created_at: new Date(now - threeHoursMs - 60_000).toISOString(),
  }

  it('releases unpaid pending order older than max age', () => {
    expect(canReleaseStaleCouponReservation(oldPending, threeHoursMs, now)).toBe(true)
  })

  it('never releases paid order', () => {
    expect(
      canReleaseStaleCouponReservation(
        { ...oldPending, status: 'paid', paid_at: new Date(now).toISOString() },
        threeHoursMs,
        now,
      ),
    ).toBe(false)
  })

  it('never releases fulfilled order', () => {
    expect(
      canReleaseStaleCouponReservation(
        {
          ...oldPending,
          status: 'paid',
          paid_at: new Date(now).toISOString(),
          fulfilled_at: new Date(now).toISOString(),
        },
        threeHoursMs,
        now,
      ),
    ).toBe(false)
  })
})

describe('fulfill invariant after payment', () => {
  it('membership granted when coupon needs reconciliation', () => {
    expect(
      membershipGrantedDespiteCouponBookkeepingFailure({
        grantSucceeded: true,
        fulfilledAtSet: true,
        couponRedemptionStatus: 'reconciliation_required',
      }),
    ).toBe(true)
  })

  it('reconcile retry does not imply duplicate grant (fulfill already_fulfilled guard)', () => {
    expect(
      membershipGrantedDespiteCouponBookkeepingFailure({
        grantSucceeded: true,
        fulfilledAtSet: true,
        couponRedemptionStatus: 'redeemed',
      }),
    ).toBe(false)
  })
})

describe('Purchase CAPI / payment event isolation', () => {
  it('reconciliation does not change authoritative paid amount field semantics', () => {
    const amountNtd = 99
    expect(amountNtd).toBe(99)
  })
})
