import { describe, expect, it } from 'vitest'
import {
  REGISTRATION_REMINDER_DAILY_SEND_CAP,
  REGISTRATION_REMINDER_MONTHLY_SEND_CAP,
  computeRegistrationReminderDailyBudget,
  computeRegistrationReminderMonthlyBudget,
  computeRegistrationReminderSendBudget,
  isRegistrationReminderStageEligible,
  pickEarliestUnsentEligibleRegistrationReminderStage,
  registrationReminderStageMinAgeMs,
  utcDayStartIso,
  utcMonthStartIso,
} from './registrationReminderEligibility'

const eligibleAfterMs = Date.parse('2026-10-18T00:00:00.000Z')
const confirmedMs = eligibleAfterMs + 60_000

describe('registration reminder lifecycle (product spec)', () => {
  it('1–2. unconfirmed / <24h → no stage1', () => {
    expect(
      isRegistrationReminderStageEligible({
        stage: 1,
        emailConfirmedAt: null,
        eligibleAfterMs,
        hasAnyVerificationApplication: false,
        hasLegacyVerificationDocsOnly: false,
      }),
    ).toBe(false)

    const nowMs = confirmedMs + registrationReminderStageMinAgeMs(1) - 1000
    expect(
      isRegistrationReminderStageEligible({
        stage: 1,
        emailConfirmedAt: new Date(confirmedMs).toISOString(),
        eligibleAfterMs,
        nowMs,
        hasAnyVerificationApplication: false,
        hasLegacyVerificationDocsOnly: false,
      }),
    ).toBe(false)
  })

  it('3–6. stage progression by sentStages + time anchors on email_confirmed_at', () => {
    const confirmed = new Date(confirmedMs).toISOString()
    const at25h = confirmedMs + registrationReminderStageMinAgeMs(1) + 3600_000

    expect(
      pickEarliestUnsentEligibleRegistrationReminderStage({
        sentStages: new Set(),
        emailConfirmedAt: confirmed,
        eligibleAfterMs,
        nowMs: at25h,
        hasAnyVerificationApplication: false,
        hasLegacyVerificationDocsOnly: false,
      }),
    ).toBe(1)

    expect(
      pickEarliestUnsentEligibleRegistrationReminderStage({
        sentStages: new Set([1]),
        emailConfirmedAt: confirmed,
        eligibleAfterMs,
        nowMs: confirmedMs + registrationReminderStageMinAgeMs(2) + 1000,
        hasAnyVerificationApplication: false,
        hasLegacyVerificationDocsOnly: false,
      }),
    ).toBe(2)

    expect(
      pickEarliestUnsentEligibleRegistrationReminderStage({
        sentStages: new Set([1, 2]),
        emailConfirmedAt: confirmed,
        eligibleAfterMs,
        nowMs: confirmedMs + registrationReminderStageMinAgeMs(3) + 1000,
        hasAnyVerificationApplication: false,
        hasLegacyVerificationDocsOnly: false,
      }),
    ).toBe(3)

    expect(
      pickEarliestUnsentEligibleRegistrationReminderStage({
        sentStages: new Set([1, 2, 3]),
        emailConfirmedAt: confirmed,
        eligibleAfterMs,
        nowMs: confirmedMs + registrationReminderStageMinAgeMs(3) + 86400_000,
        hasAnyVerificationApplication: false,
        hasLegacyVerificationDocsOnly: false,
      }),
    ).toBe(null)
  })

  it('10–13. application or legacy → stop', () => {
    const confirmed = new Date(confirmedMs).toISOString()
    const nowMs = confirmedMs + registrationReminderStageMinAgeMs(1) + 1000
    for (const hasApp of [true]) {
      expect(
        isRegistrationReminderStageEligible({
          stage: 1,
          emailConfirmedAt: confirmed,
          eligibleAfterMs,
          nowMs,
          hasAnyVerificationApplication: hasApp,
          hasLegacyVerificationDocsOnly: false,
        }),
      ).toBe(false)
    }
    expect(
      isRegistrationReminderStageEligible({
        stage: 1,
        emailConfirmedAt: confirmed,
        eligibleAfterMs,
        nowMs,
        hasAnyVerificationApplication: false,
        hasLegacyVerificationDocsOnly: true,
      }),
    ).toBe(false)
  })

  it('14–15. go-live cutoff', () => {
    const historicalConfirmed = new Date(eligibleAfterMs - 86400_000).toISOString()
    const nowMs = eligibleAfterMs + registrationReminderStageMinAgeMs(1) + 86400_000
    expect(
      isRegistrationReminderStageEligible({
        stage: 1,
        emailConfirmedAt: historicalConfirmed,
        eligibleAfterMs,
        nowMs,
        hasAnyVerificationApplication: false,
        hasLegacyVerificationDocsOnly: false,
      }),
    ).toBe(false)

    expect(
      isRegistrationReminderStageEligible({
        stage: 1,
        emailConfirmedAt: new Date(eligibleAfterMs + 1000).toISOString(),
        eligibleAfterMs,
        nowMs: eligibleAfterMs + registrationReminderStageMinAgeMs(1) + 2000,
        hasAnyVerificationApplication: false,
        hasLegacyVerificationDocsOnly: false,
      }),
    ).toBe(true)
  })

  it('21–24. 80h never sent → only stage1; stage2/3 time eligible but ordered', () => {
    const confirmed = new Date(confirmedMs).toISOString()
    const at80h = confirmedMs + 80 * 3600_000

    expect(
      isRegistrationReminderStageEligible({
        stage: 2,
        emailConfirmedAt: confirmed,
        eligibleAfterMs,
        nowMs: at80h,
        hasAnyVerificationApplication: false,
        hasLegacyVerificationDocsOnly: false,
      }),
    ).toBe(true)

    expect(
      pickEarliestUnsentEligibleRegistrationReminderStage({
        sentStages: new Set(),
        emailConfirmedAt: confirmed,
        eligibleAfterMs,
        nowMs: at80h,
        hasAnyVerificationApplication: false,
        hasLegacyVerificationDocsOnly: false,
      }),
    ).toBe(1)

    expect(
      pickEarliestUnsentEligibleRegistrationReminderStage({
        sentStages: new Set([1]),
        emailConfirmedAt: confirmed,
        eligibleAfterMs,
        nowMs: at80h,
        hasAnyVerificationApplication: false,
        hasLegacyVerificationDocsOnly: false,
      }),
    ).toBe(2)
  })

  it('25–31. UTC daily cap 30 and monthly cap 600', () => {
    expect(REGISTRATION_REMINDER_DAILY_SEND_CAP).toBe(30)
    expect(REGISTRATION_REMINDER_MONTHLY_SEND_CAP).toBe(600)

    expect(computeRegistrationReminderDailyBudget({ sentTodayUtc: 0 })).toBe(30)
    expect(computeRegistrationReminderDailyBudget({ sentTodayUtc: 29 })).toBe(1)
    expect(computeRegistrationReminderDailyBudget({ sentTodayUtc: 30 })).toBe(0)

    expect(computeRegistrationReminderMonthlyBudget({ sentThisMonthUtc: 599 })).toBe(1)
    expect(computeRegistrationReminderMonthlyBudget({ sentThisMonthUtc: 600 })).toBe(0)

    expect(
      computeRegistrationReminderSendBudget({ sentTodayUtc: 0, sentThisMonthUtc: 0 }).remaining,
    ).toBe(30)
    expect(
      computeRegistrationReminderSendBudget({ sentTodayUtc: 29, sentThisMonthUtc: 599 }).remaining,
    ).toBe(1)
    expect(
      computeRegistrationReminderSendBudget({ sentTodayUtc: 30, sentThisMonthUtc: 0 }).remaining,
    ).toBe(0)
    expect(
      computeRegistrationReminderSendBudget({ sentTodayUtc: 0, sentThisMonthUtc: 600 }).remaining,
    ).toBe(0)

    const d1 = new Date('2026-10-18T23:59:00.000Z')
    const d2 = new Date('2026-10-19T00:01:00.000Z')
    expect(utcDayStartIso(d1)).not.toBe(utcDayStartIso(d2))

    const m1 = new Date('2026-10-31T23:59:00.000Z')
    const m2 = new Date('2026-11-01T00:01:00.000Z')
    expect(utcMonthStartIso(m1)).not.toBe(utcMonthStartIso(m2))
  })

  it('stage2 eligibility uses 48h from confirmed not sent_at', () => {
    const confirmed = new Date('2026-10-18T10:00:00.000Z')
    const eligibleAfter = confirmed.getTime() - 1000
    const stage2Open = confirmed.getTime() + registrationReminderStageMinAgeMs(2)
    expect(
      isRegistrationReminderStageEligible({
        stage: 2,
        emailConfirmedAt: confirmed.toISOString(),
        eligibleAfterMs: eligibleAfter,
        nowMs: stage2Open,
        hasAnyVerificationApplication: false,
        hasLegacyVerificationDocsOnly: false,
      }),
    ).toBe(true)
    expect(
      isRegistrationReminderStageEligible({
        stage: 2,
        emailConfirmedAt: confirmed.toISOString(),
        eligibleAfterMs: eligibleAfter,
        nowMs: stage2Open - 1000,
        hasAnyVerificationApplication: false,
        hasLegacyVerificationDocsOnly: false,
      }),
    ).toBe(false)
  })
})
