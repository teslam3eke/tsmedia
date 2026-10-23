import { describe, expect, it } from 'vitest'
import {
  AUTO_REVIEW_MEMBER_AGE_MAX,
  AUTO_REVIEW_MEMBER_AGE_MIN,
  checkMemberEligibilityForAutoReview,
  isAgeInAutoReviewMemberRange,
} from './verificationMemberEligibility.js'

const base = {
  verification_status: 'submitted',
  name: 'Test',
  gender: 'male' as const,
  company: 'ACME',
  photo_urls: ['p.jpg'],
}

describe('isAgeInAutoReviewMemberRange', () => {
  it('includes boundary ages', () => {
    expect(AUTO_REVIEW_MEMBER_AGE_MIN).toBe(23)
    expect(AUTO_REVIEW_MEMBER_AGE_MAX).toBe(40)
    expect(isAgeInAutoReviewMemberRange(23)).toBe(true)
    expect(isAgeInAutoReviewMemberRange(40)).toBe(true)
    expect(isAgeInAutoReviewMemberRange(22)).toBe(false)
    expect(isAgeInAutoReviewMemberRange(41)).toBe(false)
  })
})

describe('checkMemberEligibilityForAutoReview age', () => {
  it('rejects below min with fit_age_group', () => {
    const r = checkMemberEligibilityForAutoReview({ ...base, age: 22 })
    expect(r).toEqual({
      ok: false,
      uncertain: false,
      presetId: 'fit_age_group',
      detail: 'age_out_of_range',
    })
  })

  it('rejects above max with fit_age_group', () => {
    const r = checkMemberEligibilityForAutoReview({ ...base, age: 41 })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.presetId).toBe('fit_age_group')
      expect(r.uncertain).toBe(false)
    }
  })

  it('passes in-range age', () => {
    expect(checkMemberEligibilityForAutoReview({ ...base, age: 30 })).toEqual({ ok: true })
  })

  it('missing age goes to manual (uncertain)', () => {
    const r = checkMemberEligibilityForAutoReview({ ...base, age: null })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.uncertain).toBe(true)
      expect(r.detail).toBe('missing_age')
    }
  })
})
