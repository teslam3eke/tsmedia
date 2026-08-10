import { describe, expect, it } from 'vitest'
import {
  applyFixedMembershipDiscount,
  normalizeMembershipDiscountCode,
} from './membershipDiscount'

describe('membership discount helpers', () => {
  it('normalizes codes before server-side lookup', () => {
    expect(normalizeMembershipDiscountCode(' tsvip ')).toBe('TSVIP')
    expect(normalizeMembershipDiscountCode(null)).toBe('')
  })

  it('stacks a fixed discount on the active campaign price', () => {
    expect(applyFixedMembershipDiscount(120, 100)).toBe(20)
  })

  it('never creates a zero-dollar payment order', () => {
    expect(applyFixedMembershipDiscount(80, 100)).toBe(1)
  })
})
