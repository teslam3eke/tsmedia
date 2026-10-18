/** Registration reminder eligibility（authoritative 規則；cron / deliver 共用；UTC 日／月 cap） */

export const REGISTRATION_REMINDER_DAILY_SEND_CAP = 30
export const REGISTRATION_REMINDER_MONTHLY_SEND_CAP = 600

export const REGISTRATION_REMINDER_STAGES = [1, 2, 3] as const
export type RegistrationReminderStage = (typeof REGISTRATION_REMINDER_STAGES)[number]

/** Stage N：自 auth.users.email_confirmed_at 起 N×24 小時（非 sent_at、cron 時間）。 */
const STAGE_MIN_AGE_HOURS: Record<RegistrationReminderStage, number> = {
  1: 24,
  2: 48,
  3: 72,
}

export function registrationReminderStageMinAgeMs(stage: RegistrationReminderStage): number {
  return STAGE_MIN_AGE_HOURS[stage] * 60 * 60 * 1000
}

/** @deprecated 使用 registrationReminderStageMinAgeMs(1) */
export const REGISTRATION_REMINDER_MIN_AGE_MS = registrationReminderStageMinAgeMs(1)

/** Registration Reminder 配額以 UTC calendar day / month 計（與其他 cron 一致）。 */
export function utcDayStartIso(d = new Date()): string {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())).toISOString()
}

export function utcMonthStartIso(d = new Date()): string {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString()
}

export function nextUtcDayStartIso(d = new Date()): string {
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1),
  ).toISOString()
}

export function computeRegistrationReminderDailyBudget(params: {
  sentTodayUtc: number
  dailyCap?: number
}): number {
  const cap = params.dailyCap ?? REGISTRATION_REMINDER_DAILY_SEND_CAP
  return Math.max(0, cap - Math.max(0, params.sentTodayUtc))
}

export function computeRegistrationReminderMonthlyBudget(params: {
  sentThisMonthUtc: number
  monthlyCap?: number
}): number {
  const cap = params.monthlyCap ?? REGISTRATION_REMINDER_MONTHLY_SEND_CAP
  return Math.max(0, cap - Math.max(0, params.sentThisMonthUtc))
}

export function computeRegistrationReminderSendBudget(params: {
  sentTodayUtc: number
  sentThisMonthUtc: number
  dailyCap?: number
  monthlyCap?: number
}): { remaining: number; dailyRemaining: number; monthlyRemaining: number } {
  const dailyRemaining = computeRegistrationReminderDailyBudget({
    sentTodayUtc: params.sentTodayUtc,
    dailyCap: params.dailyCap,
  })
  const monthlyRemaining = computeRegistrationReminderMonthlyBudget({
    sentThisMonthUtc: params.sentThisMonthUtc,
    monthlyCap: params.monthlyCap,
  })
  return {
    remaining: Math.min(dailyRemaining, monthlyRemaining),
    dailyRemaining,
    monthlyRemaining,
  }
}

export function isRegistrationReminderStageEligible(params: {
  stage: RegistrationReminderStage
  emailConfirmedAt: string | null | undefined
  eligibleAfterMs: number
  nowMs?: number
  hasAnyVerificationApplication: boolean
  hasLegacyVerificationDocsOnly: boolean
}): boolean {
  if (params.hasAnyVerificationApplication) return false
  if (params.hasLegacyVerificationDocsOnly) return false

  const confirmedRaw = params.emailConfirmedAt
  if (!confirmedRaw) return false

  const confirmedMs = new Date(confirmedRaw).getTime()
  if (!Number.isFinite(confirmedMs)) return false

  const nowMs = params.nowMs ?? Date.now()
  if (confirmedMs < params.eligibleAfterMs) return false
  if (nowMs - confirmedMs < registrationReminderStageMinAgeMs(params.stage)) return false

  return true
}

/** Resend 前：Stage 2 需 stage 1 已 sent；Stage 3 需 stage 1+2 已 sent。 */
export function areRegistrationReminderStagePredecessorsSent(
  sentStages: ReadonlySet<RegistrationReminderStage>,
  stage: RegistrationReminderStage,
): boolean {
  if (stage === 1) return true
  if (stage === 2) return sentStages.has(1)
  return sentStages.has(1) && sentStages.has(2)
}

/** 同一次 Cron 每 user 最多一封：最早尚未 sent 且時間 eligible 的 stage。 */
export function pickEarliestUnsentEligibleRegistrationReminderStage(params: {
  sentStages: ReadonlySet<RegistrationReminderStage>
  emailConfirmedAt: string | null | undefined
  eligibleAfterMs: number
  nowMs?: number
  hasAnyVerificationApplication: boolean
  hasLegacyVerificationDocsOnly: boolean
}): RegistrationReminderStage | null {
  if (params.hasAnyVerificationApplication || params.hasLegacyVerificationDocsOnly) return null
  if (!params.emailConfirmedAt) return null

  for (const stage of REGISTRATION_REMINDER_STAGES) {
    if (params.sentStages.has(stage)) continue
    if (
      isRegistrationReminderStageEligible({
        stage,
        emailConfirmedAt: params.emailConfirmedAt,
        eligibleAfterMs: params.eligibleAfterMs,
        nowMs: params.nowMs,
        hasAnyVerificationApplication: false,
        hasLegacyVerificationDocsOnly: false,
      })
    ) {
      return stage
    }
  }
  return null
}

/** Stage 1 別名（測試／向後相容）。 */
export function isRegistrationReminderEligible(params: {
  emailConfirmedAt: string | null | undefined
  eligibleAfterMs: number
  nowMs?: number
  hasAnyVerificationApplication: boolean
  hasLegacyVerificationDocsOnly: boolean
}): boolean {
  return isRegistrationReminderStageEligible({ ...params, stage: 1 })
}
