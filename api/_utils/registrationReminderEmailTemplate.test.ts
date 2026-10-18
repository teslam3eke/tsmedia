import { describe, expect, it } from 'vitest'
import {
  EMAIL_LAUNCH_FROM_PARAM,
  EMAIL_LAUNCH_VERIFICATION_REMINDER_VALUE,
  REGISTRATION_REMINDER_EMAIL_SUBJECT,
  REGISTRATION_REMINDER_EMAIL_SUBJECT_BY_STAGE,
  buildRegistrationReminderEmailContent,
  buildRegistrationReminderEmailCtaUrl,
} from './registrationReminderEmailTemplate'

describe('registration reminder email template', () => {
  it('CTA uses verification_reminder without PII', () => {
    const url = buildRegistrationReminderEmailCtaUrl('https://tsmedia.tw')
    expect(url).toBe(
      `https://tsmedia.tw/?${EMAIL_LAUNCH_FROM_PARAM}=${EMAIL_LAUNCH_VERIFICATION_REMINDER_VALUE}`,
    )
    expect(url).not.toMatch(/user_id|entitlement|uuid|@|reminder_stage/i)
  })

  it('includes product copy and footer (stage 1)', () => {
    const c = buildRegistrationReminderEmailContent('https://tsmedia.tw', 1)
    expect(c.subject).toBe(REGISTRATION_REMINDER_EMAIL_SUBJECT)
    expect(c.html).toContain('繼續完成申請')
    expect(c.text).toContain('我們會在收到資料後進行人工審核')
    expect(c.text).toContain('在這裡，讓你遇見改變世界的人')
  })

  it('stage 2 and 3 match product spec subjects and footers', () => {
    const s2 = buildRegistrationReminderEmailContent('https://tsmedia.tw', 2)
    const s3 = buildRegistrationReminderEmailContent('https://tsmedia.tw', 3)
    expect(s2.subject).toBe(REGISTRATION_REMINDER_EMAIL_SUBJECT_BY_STAGE[2])
    expect(s3.subject).toBe(REGISTRATION_REMINDER_EMAIL_SUBJECT_BY_STAGE[3])
    expect(s2.text).toContain('可以直接從上次的進度繼續')
    expect(s2.text).toContain('完成資料並送出後')
    expect(s3.text).toContain('最後一封提醒')
    expect(s2.ctaUrl).toBe(s3.ctaUrl)
  })
})
