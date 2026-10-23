import { describe, expect, it } from 'vitest'
import {
  buildAutoTextRejectReviewerNote,
  userFacingRejectReasonFromReviewerNote,
} from './verificationRejectPresetMessages.js'

describe('userFacingRejectReasonFromReviewerNote', () => {
  it('maps auto preset note to zh-TW user message', () => {
    const note = buildAutoTextRejectReviewerNote('fit_age_group')
    const msg = userFacingRejectReasonFromReviewerNote(note)
    expect(msg).toContain('年齡')
    expect(msg).not.toContain('AUTO_TEXT_REJECT')
    expect(msg).not.toContain('fit_age_group')
  })

  it('passes through manual reviewer note', () => {
    expect(userFacingRejectReasonFromReviewerNote('請補充生活照')).toBe('請補充生活照')
  })
})
