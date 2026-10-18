import type { SupabaseClient } from '@supabase/supabase-js'
import {
  REGISTRATION_REMINDER_STAGES,
  type RegistrationReminderStage,
  computeRegistrationReminderSendBudget,
  isRegistrationReminderStageEligible,
  pickEarliestUnsentEligibleRegistrationReminderStage,
} from './registrationReminderEligibility.js'
import {
  countRegistrationRemindersSentThisMonthUtc,
  countRegistrationRemindersSentTodayUtc,
  deliverRegistrationReminderEmailIfNeeded,
  loadRegistrationReminderEligibleAfterMs,
  loadRegistrationReminderSentStages,
  retryPendingRegistrationReminderEmails,
  type RegistrationReminderRunGuard,
} from './deliverRegistrationReminderEmailIfNeeded.js'

/** Cron JSON 回應（不含 user id / email 等 PII）。 */
export type RegistrationReminderCronStats = {
  scanned: number
  eligibleStage1: number
  eligibleStage2: number
  eligibleStage3: number
  sentStage1: number
  sentStage2: number
  sentStage3: number
  skippedSubmitted: number
  skippedLegacy: number
  skippedDailyCap: boolean
  skippedMonthlyCap: boolean
  alreadySent: number
  emailFailures: number
  errors: number
}

function emptyStats(): RegistrationReminderCronStats {
  return {
    scanned: 0,
    eligibleStage1: 0,
    eligibleStage2: 0,
    eligibleStage3: 0,
    sentStage1: 0,
    sentStage2: 0,
    sentStage3: 0,
    skippedSubmitted: 0,
    skippedLegacy: 0,
    skippedDailyCap: false,
    skippedMonthlyCap: false,
    alreadySent: 0,
    emailFailures: 0,
    errors: 0,
  }
}

function bumpEligibleStage(stats: RegistrationReminderCronStats, stage: RegistrationReminderStage): void {
  if (stage === 1) stats.eligibleStage1 += 1
  else if (stage === 2) stats.eligibleStage2 += 1
  else stats.eligibleStage3 += 1
}

function bumpSentStage(stats: RegistrationReminderCronStats, stage: RegistrationReminderStage): void {
  if (stage === 1) stats.sentStage1 += 1
  else if (stage === 2) stats.sentStage2 += 1
  else stats.sentStage3 += 1
}

async function loadSubmittedUserIds(admin: SupabaseClient): Promise<Set<string>> {
  const ids = new Set<string>()
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin
      .from('verification_applications')
      .select('user_id')
      .range(from, from + 999)
    if (error) throw error
    if (!data?.length) break
    for (const r of data) {
      if (typeof r.user_id === 'string') ids.add(r.user_id)
    }
  }
  return ids
}

async function loadLegacyDocsOnlyUserIds(admin: SupabaseClient): Promise<Set<string>> {
  const submitted = await loadSubmittedUserIds(admin)
  const legacy = new Set<string>()
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin.from('verification_docs').select('user_id').range(from, from + 999)
    if (error) throw error
    if (!data?.length) break
    for (const r of data) {
      const id = r.user_id
      if (typeof id === 'string' && !submitted.has(id)) legacy.add(id)
    }
  }
  return legacy
}

export async function runRegistrationReminderEmailCron(
  admin: SupabaseClient,
): Promise<RegistrationReminderCronStats> {
  const stats = emptyStats()
  const runGuard: RegistrationReminderRunGuard = { sentUserIdsThisRun: new Set() }

  const eligibleAfterMs = await loadRegistrationReminderEligibleAfterMs(admin)
  if (eligibleAfterMs === null) {
    stats.errors += 1
    return stats
  }

  const sentTodayUtc = await countRegistrationRemindersSentTodayUtc(admin)
  const sentThisMonthUtc = await countRegistrationRemindersSentThisMonthUtc(admin)
  const budget = computeRegistrationReminderSendBudget({ sentTodayUtc, sentThisMonthUtc })

  if (budget.remaining <= 0) {
    stats.skippedDailyCap = budget.dailyRemaining <= 0
    stats.skippedMonthlyCap = budget.monthlyRemaining <= 0
    return stats
  }

  const submittedIds = await loadSubmittedUserIds(admin)
  const legacyIds = await loadLegacyDocsOnlyUserIds(admin)

  let remaining = budget.remaining

  for (let page = 1; remaining > 0; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 })
    if (error) {
      stats.errors += 1
      throw error
    }
    const users = data.users ?? []
    if (!users.length) break

    for (const u of users) {
      stats.scanned += 1
      const confirmedAt = u.email_confirmed_at ?? null
      if (!confirmedAt) continue

      const hasApp = submittedIds.has(u.id)
      const legacy = legacyIds.has(u.id)

      if (hasApp) {
        stats.skippedSubmitted += 1
        continue
      }
      if (legacy) {
        stats.skippedLegacy += 1
        continue
      }

      if (runGuard.sentUserIdsThisRun.has(u.id)) continue

      for (const stage of REGISTRATION_REMINDER_STAGES) {
        if (
          isRegistrationReminderStageEligible({
            stage,
            emailConfirmedAt: confirmedAt,
            eligibleAfterMs,
            hasAnyVerificationApplication: false,
            hasLegacyVerificationDocsOnly: false,
          })
        ) {
          bumpEligibleStage(stats, stage)
        }
      }

      const sentStages = await loadRegistrationReminderSentStages(admin, u.id)
      const stage = pickEarliestUnsentEligibleRegistrationReminderStage({
        sentStages,
        emailConfirmedAt: confirmedAt,
        eligibleAfterMs,
        hasAnyVerificationApplication: hasApp,
        hasLegacyVerificationDocsOnly: legacy,
      })
      if (!stage) continue
      if (remaining <= 0) break

      const outcome = await deliverRegistrationReminderEmailIfNeeded(admin, u.id, {
        stage,
        emailConfirmedAt: confirmedAt,
        eligibleAfterMs,
        hasAnyVerificationApplication: hasApp,
        hasLegacyVerificationDocsOnly: legacy,
        runGuard,
      })

      if (outcome === 'sent') {
        bumpSentStage(stats, stage)
        remaining -= 1
      } else if (outcome === 'already_sent') {
        stats.alreadySent += 1
      } else if (outcome === 'failed') {
        stats.emailFailures += 1
      }
    }

    if (users.length < 1000) break
  }

  if (remaining > 0) {
    const retry = await retryPendingRegistrationReminderEmails(admin, {
      limit: remaining,
      eligibleAfterMs,
      runGuard,
      submittedUserIds: submittedIds,
      legacyUserIds: legacyIds,
    })
    stats.emailFailures += retry.failed
    stats.sentStage1 += retry.sentByStage[1]
    stats.sentStage2 += retry.sentByStage[2]
    stats.sentStage3 += retry.sentByStage[3]
  }

  return stats
}
