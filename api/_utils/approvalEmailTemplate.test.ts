import { describe, expect, it } from 'vitest'
import {
  APPROVAL_EMAIL_SUBJECT,
  EMAIL_LAUNCH_APPROVAL_VALUE,
  EMAIL_LAUNCH_FROM_PARAM,
  buildApprovalEmailCtaUrl,
  buildApprovalEmailContent,
} from './approvalEmailTemplate'

describe('approval email template', () => {
  it('CTA contains fromEmail=approval without PII', () => {
    const url = buildApprovalEmailCtaUrl('https://tsmedia.tw')
    expect(url).toBe(`https://tsmedia.tw/?${EMAIL_LAUNCH_FROM_PARAM}=${EMAIL_LAUNCH_APPROVAL_VALUE}`)
    expect(url).not.toMatch(/user_id|jwt|access_token|refresh_token|@/i)
  })

  it('builds html and plaintext', () => {
    const c = buildApprovalEmailContent('https://tsmedia.tw')
    expect(c.subject).toBe(APPROVAL_EMAIL_SUBJECT)
    expect(c.html).toContain('開始探索')
    expect(c.html).toContain(c.ctaUrl)
    expect(c.text).toContain('開始探索')
    expect(c.text).toContain(c.ctaUrl)
  })

  it('escapes malicious site url fragments in html attr', () => {
    const c = buildApprovalEmailContent('https://tsmedia.tw')
    expect(c.html).not.toContain('"><script')
  })
})
