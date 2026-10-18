import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

describe('registration reminder isolation', () => {
  it('cron uses registration reminder runner only', () => {
    const src = fs.readFileSync(
      path.join(root, 'api/cron-registration-reminder-email.ts'),
      'utf8',
    )
    expect(src).toMatch(/runRegistrationReminderEmailCron/)
    expect(src).not.toMatch(/issue_acquisition_coupon/)
    expect(src).not.toMatch(/deliverApprovalEmailIfNeeded/)
  })

  it('22–23. approval and acquisition paths unchanged in this feature files', () => {
    const approval = fs.readFileSync(
      path.join(root, 'api/_utils/deliverApprovalEmailIfNeeded.ts'),
      'utf8',
    )
    const acquisition = fs.readFileSync(
      path.join(root, 'api/_utils/deliverAcquisitionCouponEmailIfNeeded.ts'),
      'utf8',
    )
    expect(approval).toMatch(/claim_verification_approval_email_delivery/)
    expect(acquisition).toMatch(/claim_acquisition_coupon_email_delivery/)
  })

  it('24. Purchase CAPI entry unchanged', () => {
    const capi = fs.readFileSync(path.join(root, 'api/meta-capi-complete-registration.ts'), 'utf8')
    expect(capi).toMatch(/readAuthedUserId/)
    expect(capi).not.toMatch(/registration_reminder/)
  })

  it('21. emailLaunchSource supports verification_reminder', () => {
    const src = fs.readFileSync(path.join(root, 'src/lib/emailLaunchSource.ts'), 'utf8')
    expect(src).toMatch(/verification_reminder/)
    expect(src).not.toMatch(/identity-verify/)
  })

  it('cron handler requires CRON_SECRET (fail closed)', () => {
    const src = fs.readFileSync(
      path.join(root, 'api/cron-registration-reminder-email.ts'),
      'utf8',
    )
    expect(src).toMatch(/if \(!cronSecret\)/)
    expect(src).toMatch(/cron secret missing/)
  })

  it('deliver console.warn must not log raw userId', () => {
    const src = fs.readFileSync(
      path.join(root, 'api/_utils/deliverRegistrationReminderEmailIfNeeded.ts'),
      'utf8',
    )
    const warnLines = src.split('\n').filter((l) => l.includes('console.warn'))
    for (const line of warnLines) {
      expect(line).not.toMatch(/userId:/)
    }
  })

  it('cron response exposes observability counters without PII keys', () => {
    const src = fs.readFileSync(
      path.join(root, 'api/_utils/registrationReminderCron.ts'),
      'utf8',
    )
    expect(src).toMatch(/scanned:/)
    expect(src).toMatch(/eligibleStage1:/)
    expect(src).toMatch(/skippedDailyCap:/)
    expect(src).toMatch(/skippedMonthlyCap:/)
    expect(src).not.toMatch(/email:/)
    expect(src).not.toMatch(/userId:/)
  })

  it('daily cap constant in eligibility module', () => {
    const src = fs.readFileSync(
      path.join(root, 'api/_utils/registrationReminderEligibility.ts'),
      'utf8',
    )
    expect(src).toMatch(/REGISTRATION_REMINDER_DAILY_SEND_CAP = 30/)
    expect(src).toMatch(/REGISTRATION_REMINDER_MONTHLY_SEND_CAP = 600/)
  })
})
