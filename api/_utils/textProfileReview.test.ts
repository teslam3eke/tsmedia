import { describe, expect, it } from 'vitest'
import { reviewTextProfile } from './textProfileReview.js'

describe('reviewTextProfile', () => {
  it('blank bio with valid questionnaire passes', () => {
    const r = reviewTextProfile('', [{ id: 1, answer: '喜歡爬山跟攝影' }])
    expect(r.verdict).toBe('PASS')
  })

  it('normal short answer passes', () => {
    const r = reviewTextProfile(null, [{ id: 2, answer: '喜歡爬山跟攝影' }])
    expect(r.verdict).toBe('PASS')
  })

  it('garbage punctuation fails with repeat or bio_too_short', () => {
    const r = reviewTextProfile(null, [{ id: 3, answer: '!!!!!' }])
    expect(r.verdict).toBe('NEEDS_EDIT')
  })

  it('perfunctory 不知道 fails', () => {
    const r = reviewTextProfile(null, [{ id: 4, answer: '不知道' }])
    expect(r.verdict).toBe('NEEDS_EDIT')
    expect(r.presetId).toBe('bio_too_short')
  })

  it('repeat stuffing fails', () => {
    const r = reviewTextProfile(null, [{ id: 5, answer: '哈哈哈哈哈哈' }])
    expect(r.verdict).toBe('NEEDS_EDIT')
    expect(r.presetId).toBe('text_repeat_stuffing')
  })

  it('IG contact fails off_platform', () => {
    const r = reviewTextProfile(null, [{ id: 6, answer: '我的 IG：abc_test' }])
    expect(r.verdict).toBe('NEEDS_EDIT')
    expect(r.presetId).toBe('text_off_platform')
  })

  it('LINE fails off_platform', () => {
    const r = reviewTextProfile(null, [{ id: 7, answer: '加我 LINE id: myline1234' }])
    expect(r.verdict).toBe('NEEDS_EDIT')
    expect(r.presetId).toBe('text_off_platform')
  })

  it('skips turning point question 9000', () => {
    const r = reviewTextProfile(null, [
      { id: 9000, answer: '!!!!!' },
      { id: 8, answer: '週末常去咖啡廳看書' },
    ])
    expect(r.verdict).toBe('PASS')
  })
})
