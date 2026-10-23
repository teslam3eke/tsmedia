import { describe, expect, it } from 'vitest'
import { verificationRejectionReasonForDisplay } from './verificationAiUtils'

describe('verificationRejectionReasonForDisplay', () => {
  it('maps AUTO_TEXT_REJECT preset to zh-TW', () => {
    const msg = verificationRejectionReasonForDisplay('AUTO_TEXT_REJECT:text_repeat_stuffing')
    expect(msg).toContain('重複')
    expect(msg).not.toMatch(/AUTO_TEXT|text_repeat/)
  })
})
