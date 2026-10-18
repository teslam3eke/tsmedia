import { describe, expect, it } from 'vitest'
import {
  REGISTRATION_REMINDER_MIN_AGE_MS,
  computeRegistrationReminderSendBudget,
  isRegistrationReminderEligible,
  isRegistrationReminderStageEligible,
  registrationReminderStageMinAgeMs,
  utcDayStartIso,
} from './registrationReminderEligibility'

const eligibleAfterMs = Date.parse('2026-10-18T00:00:00.000Z')

describe('isRegistrationReminderEligible', () => {
  it('1. confirmed <24h → not eligible', () => {
    const confirmed = new Date(eligibleAfterMs + 60_000).toISOString()
    const nowMs = eligibleAfterMs + REGISTRATION_REMINDER_MIN_AGE_MS - 1000
    expect(
      isRegistrationReminderEligible({
        emailConfirmedAt: confirmed,
        eligibleAfterMs,
        nowMs,
        hasAnyVerificationApplication: false,
        hasLegacyVerificationDocsOnly: false,
      }),
    ).toBe(false)
  })

  it('2. confirmed >=24h + never submitted → eligible', () => {
    const confirmedMs = eligibleAfterMs + 60_000
    const confirmed = new Date(confirmedMs).toISOString()
    const nowMs = confirmedMs + REGISTRATION_REMINDER_MIN_AGE_MS + 1000
    expect(
      isRegistrationReminderEligible({
        emailConfirmedAt: confirmed,
        eligibleAfterMs,
        nowMs,
        hasAnyVerificationApplication: false,
        hasLegacyVerificationDocsOnly: false,
      }),
    ).toBe(true)
  })

  it('3–5. gender not part of eligibility (male/female/unknown same rule)', () => {
    const confirmed = new Date(eligibleAfterMs + 3600_000).toISOString()
    const nowMs = eligibleAfterMs + REGISTRATION_REMINDER_MIN_AGE_MS + 3600_000
    const base = {
      emailConfirmedAt: confirmed,
      eligibleAfterMs,
      nowMs,
      hasAnyVerificationApplication: false,
      hasLegacyVerificationDocsOnly: false,
    }
    expect(isRegistrationReminderEligible(base)).toBe(true)
  })

  it('6–8. any verification application → not eligible', () => {
    const confirmed = new Date(eligibleAfterMs + 3600_000).toISOString()
    const nowMs = eligibleAfterMs + REGISTRATION_REMINDER_MIN_AGE_MS + 3600_000
    expect(
      isRegistrationReminderEligible({
        emailConfirmedAt: confirmed,
        eligibleAfterMs,
        nowMs,
        hasAnyVerificationApplication: true,
        hasLegacyVerificationDocsOnly: false,
      }),
    ).toBe(false)
  })

  it('9. legacy verification_docs only → not eligible', () => {
    const confirmed = new Date(eligibleAfterMs + 3600_000).toISOString()
    const nowMs = eligibleAfterMs + REGISTRATION_REMINDER_MIN_AGE_MS + 3600_000
    expect(
      isRegistrationReminderEligible({
        emailConfirmedAt: confirmed,
        eligibleAfterMs,
        nowMs,
        hasAnyVerificationApplication: false,
        hasLegacyVerificationDocsOnly: true,
      }),
    ).toBe(false)
  })

  it('10. historical user confirmed before go-live cutoff → not eligible', () => {
    const confirmed = new Date(eligibleAfterMs - 86400_000).toISOString()
    const nowMs = eligibleAfterMs + REGISTRATION_REMINDER_MIN_AGE_MS + 86400_000
    expect(
      isRegistrationReminderEligible({
        emailConfirmedAt: confirmed,
        eligibleAfterMs,
        nowMs,
        hasAnyVerificationApplication: false,
        hasLegacyVerificationDocsOnly: false,
      }),
    ).toBe(false)
  })

  it('11. user confirmed after go-live → eligible after 24h', () => {
    const confirmed = new Date(eligibleAfterMs + 1000).toISOString()
    const nowMs = eligibleAfterMs + REGISTRATION_REMINDER_MIN_AGE_MS + 2000
    expect(
      isRegistrationReminderEligible({
        emailConfirmedAt: confirmed,
        eligibleAfterMs,
        nowMs,
        hasAnyVerificationApplication: false,
        hasLegacyVerificationDocsOnly: false,
      }),
    ).toBe(true)
  })
})

describe('isRegistrationReminderStageEligible (stages 2–3)', () => {
  it('stage 2 requires 48h; stage 3 requires 72h', () => {
    const confirmedMs = eligibleAfterMs + 60_000
    const confirmed = new Date(confirmedMs).toISOString()

    const at47h = confirmedMs + registrationReminderStageMinAgeMs(2) - 1000
    expect(
      isRegistrationReminderStageEligible({
        stage: 2,
        emailConfirmedAt: confirmed,
        eligibleAfterMs,
        nowMs: at47h,
        hasAnyVerificationApplication: false,
        hasLegacyVerificationDocsOnly: false,
      }),
    ).toBe(false)

    const at49h = confirmedMs + registrationReminderStageMinAgeMs(2) + 1000
    expect(
      isRegistrationReminderStageEligible({
        stage: 2,
        emailConfirmedAt: confirmed,
        eligibleAfterMs,
        nowMs: at49h,
        hasAnyVerificationApplication: false,
        hasLegacyVerificationDocsOnly: false,
      }),
    ).toBe(true)

    const at71h = confirmedMs + registrationReminderStageMinAgeMs(3) - 1000
    expect(
      isRegistrationReminderStageEligible({
        stage: 3,
        emailConfirmedAt: confirmed,
        eligibleAfterMs,
        nowMs: at71h,
        hasAnyVerificationApplication: false,
        hasLegacyVerificationDocsOnly: false,
      }),
    ).toBe(false)

    const at73h = confirmedMs + registrationReminderStageMinAgeMs(3) + 1000
    expect(
      isRegistrationReminderStageEligible({
        stage: 3,
        emailConfirmedAt: confirmed,
        eligibleAfterMs,
        nowMs: at73h,
        hasAnyVerificationApplication: false,
        hasLegacyVerificationDocsOnly: false,
      }),
    ).toBe(true)
  })
})

describe('computeRegistrationReminderSendBudget (UTC daily cap)', () => {
  it('17–19. daily sent budget', () => {
    expect(computeRegistrationReminderSendBudget({ sentTodayUtc: 0, sentThisMonthUtc: 0 }).remaining).toBe(30)
    expect(computeRegistrationReminderSendBudget({ sentTodayUtc: 17, sentThisMonthUtc: 0 }).remaining).toBe(13)
    expect(computeRegistrationReminderSendBudget({ sentTodayUtc: 30, sentThisMonthUtc: 0 }).remaining).toBe(0)
    expect(computeRegistrationReminderSendBudget({ sentTodayUtc: 25, sentThisMonthUtc: 0 }).remaining).toBe(5)
  })

  it('20. next UTC day boundary is distinct', () => {
    const d = new Date('2026-10-18T23:59:00.000Z')
    expect(utcDayStartIso(d)).toBe('2026-10-18T00:00:00.000Z')
    const next = new Date('2026-10-19T00:01:00.000Z')
    expect(utcDayStartIso(next)).toBe('2026-10-19T00:00:00.000Z')
  })
})
