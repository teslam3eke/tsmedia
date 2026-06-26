import { describe, expect, it } from 'vitest'
import { looksLikeTsmcEwcVirtualBadge } from './employerMatch.js'

describe('looksLikeTsmcEwcVirtualBadge', () => {
  it('accepts TSMC EWC virtual badge fields from AI', () => {
    expect(
      looksLikeTsmcEwcVirtualBadge({
        detectedEmployer: '台灣積體電路製造股份有限公司',
        employerEvidenceQuote: '職工福利委員會 虛擬識別證',
        reason: '台積電 App 虛擬識別證',
      }),
    ).toBe(true)
  })

  it('rejects virtual badge wording without TSMC employer evidence', () => {
    expect(
      looksLikeTsmcEwcVirtualBadge({
        reason: '此為虛擬識別證但無法確認公司',
      }),
    ).toBe(false)
  })

  it('rejects unrelated TSMC docs without virtual badge label', () => {
    expect(
      looksLikeTsmcEwcVirtualBadge({
        detectedEmployer: '台灣積體電路製造股份有限公司',
        reason: '扣繳憑單',
      }),
    ).toBe(false)
  })
})
