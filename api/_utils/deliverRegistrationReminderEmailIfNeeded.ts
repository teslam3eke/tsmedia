import type { SupabaseClient } from '@supabase/supabase-js'
import {
  REGISTRATION_REMINDER_DAILY_SEND_CAP,
  REGISTRATION_REMINDER_MONTHLY_SEND_CAP,
  type RegistrationReminderStage,
  areRegistrationReminderStagePredecessorsSent,
  isRegistrationReminderStageEligible,
  pickEarliestUnsentEligibleRegistrationReminderStage,
  utcMonthStartIso,
} from './registrationReminderEligibility.js'
import { sendRegistrationReminderEmailToRecipient } from './registrationReminderEmailSend.js'

export type DeliverRegistrationReminderOutcome = 'sent' | 'skipped' | 'failed' | 'already_sent'

/** 同一 cron execution：已成功寄出過的 user（main + retry 共用）。 */
export type RegistrationReminderRunGuard = {
  sentUserIdsThisRun: Set<string>
}

type ClaimRow = { userId: string; reminderStage: RegistrationReminderStage }

function parseClaim(data: unknown): ClaimRow | null {
  if (!data || typeof data !== 'object') return null
  const o = data as Record<string, unknown>
  if (o.ok !== true) return null
  const userId = typeof o.user_id === 'string' ? o.user_id : ''
  const stageRaw = o.reminder_stage
  const reminderStage =
    stageRaw === 1 || stageRaw === 2 || stageRaw === 3 ? stageRaw : null
  if (!userId || reminderStage === null) return null
  return { userId, reminderStage }
}

function parseClaimReason(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null
  const o = data as Record<string, unknown>
  if (o.ok !== false) return null
  return typeof o.reason === 'string' ? o.reason : null
}

export async function loadRegistrationReminderEligibleAfterMs(
  admin: SupabaseClient,
): Promise<number | null> {
  const { data, error } = await admin.rpc('registration_reminder_eligible_after')
  if (error) {
    console.warn('[registration-reminder] eligible_after failed', { message: error.message })
    return null
  }
  const ms = new Date(String(data)).getTime()
  return Number.isFinite(ms) ? ms : null
}

export async function loadRegistrationReminderSentStages(
  admin: SupabaseClient,
  userId: string,
): Promise<Set<RegistrationReminderStage>> {
  const sent = new Set<RegistrationReminderStage>()
  const { data, error } = await admin
    .from('registration_reminder_email_deliveries')
    .select('reminder_stage')
    .eq('user_id', userId)
    .not('sent_at', 'is', null)
  if (error) {
    console.warn('[registration-reminder] sent stages load failed', { message: error.message })
    return sent
  }
  for (const row of data ?? []) {
    const s = row.reminder_stage
    if (s === 1 || s === 2 || s === 3) sent.add(s)
  }
  return sent
}

export async function userHasAnyVerificationApplication(
  admin: SupabaseClient,
  userId: string,
): Promise<boolean> {
  const { data, error } = await admin
    .from('verification_applications')
    .select('id')
    .eq('user_id', userId)
    .limit(1)
  if (error) {
    console.warn('[registration-reminder] application check failed', { message: error.message })
    return true
  }
  return Boolean(data?.length)
}

export async function userHasLegacyVerificationDocsOnly(
  admin: SupabaseClient,
  userId: string,
): Promise<boolean> {
  const { data: docs, error: docsErr } = await admin
    .from('verification_docs')
    .select('id')
    .eq('user_id', userId)
    .limit(1)
  if (docsErr) {
    console.warn('[registration-reminder] docs check failed', { message: docsErr.message })
    return true
  }
  if (!docs?.length) return false
  return !(await userHasAnyVerificationApplication(admin, userId))
}

async function loadAuthEmailConfirmed(
  admin: SupabaseClient,
  userId: string,
): Promise<{ email: string; emailConfirmedAt: string } | null> {
  try {
    const { data, error } = await admin.auth.admin.getUserById(userId)
    if (error || !data.user?.email) return null
    const email = data.user.email.trim()
    const emailConfirmedAt = data.user.email_confirmed_at ?? null
    if (!email || !email.includes('@') || !emailConfirmedAt) return null
    return { email, emailConfirmedAt }
  } catch {
    return null
  }
}

async function releaseInFlight(
  admin: SupabaseClient,
  userId: string,
  stage: RegistrationReminderStage,
  errorCode: string,
): Promise<void> {
  await admin.rpc('release_registration_reminder_email_in_flight', {
    p_user_id: userId,
    p_reminder_stage: stage,
    p_error: errorCode,
  })
}

/** Resend 前 authoritative：predecessor、pickEarliest 一致、stage 未 sent。 */
export async function assertAuthoritativeRegistrationReminderSendReady(
  admin: SupabaseClient,
  params: {
    userId: string
    stage: RegistrationReminderStage
    emailConfirmedAt: string
    eligibleAfterMs: number
    hasAnyVerificationApplication: boolean
    hasLegacyVerificationDocsOnly: boolean
  },
): Promise<
  | { ok: true; sentStages: Set<RegistrationReminderStage> }
  | { ok: false; reason: string }
> {
  const sentStages = await loadRegistrationReminderSentStages(admin, params.userId)

  if (sentStages.has(params.stage)) {
    return { ok: false, reason: 'stage_already_sent' }
  }

  if (!areRegistrationReminderStagePredecessorsSent(sentStages, params.stage)) {
    return { ok: false, reason: 'predecessor_stage_not_sent' }
  }

  const expectedStage = pickEarliestUnsentEligibleRegistrationReminderStage({
    sentStages,
    emailConfirmedAt: params.emailConfirmedAt,
    eligibleAfterMs: params.eligibleAfterMs,
    hasAnyVerificationApplication: params.hasAnyVerificationApplication,
    hasLegacyVerificationDocsOnly: params.hasLegacyVerificationDocsOnly,
  })

  if (expectedStage !== params.stage) {
    return { ok: false, reason: 'not_earliest_eligible_stage' }
  }

  if (
    !isRegistrationReminderStageEligible({
      stage: params.stage,
      emailConfirmedAt: params.emailConfirmedAt,
      eligibleAfterMs: params.eligibleAfterMs,
      hasAnyVerificationApplication: params.hasAnyVerificationApplication,
      hasLegacyVerificationDocsOnly: params.hasLegacyVerificationDocsOnly,
    })
  ) {
    return { ok: false, reason: 'stage_not_time_eligible' }
  }

  return { ok: true, sentStages }
}

/** 寄送前再次 authoritative check；永不 throw。 */
export async function deliverRegistrationReminderEmailIfNeeded(
  admin: SupabaseClient,
  userId: string,
  ctx: {
    stage: RegistrationReminderStage
    emailConfirmedAt: string
    eligibleAfterMs: number
    hasAnyVerificationApplication: boolean
    hasLegacyVerificationDocsOnly: boolean
    runGuard?: RegistrationReminderRunGuard
  },
): Promise<DeliverRegistrationReminderOutcome> {
  const uid = userId.trim()
  if (!uid) return 'skipped'

  if (ctx.runGuard?.sentUserIdsThisRun.has(uid)) {
    return 'skipped'
  }

  try {
    if (
      !isRegistrationReminderStageEligible({
        stage: ctx.stage,
        emailConfirmedAt: ctx.emailConfirmedAt,
        eligibleAfterMs: ctx.eligibleAfterMs,
        hasAnyVerificationApplication: ctx.hasAnyVerificationApplication,
        hasLegacyVerificationDocsOnly: ctx.hasLegacyVerificationDocsOnly,
      })
    ) {
      return 'skipped'
    }

    const { data: claimRaw, error: claimErr } = await admin.rpc(
      'claim_registration_reminder_email_delivery',
      { p_user_id: uid, p_reminder_stage: ctx.stage },
    )
    if (claimErr) {
      console.warn('[registration-reminder] claim failed', {
        stage: ctx.stage,
        message: claimErr.message,
      })
      return 'failed'
    }

    const row = parseClaim(claimRaw)
    if (!row) {
      if (parseClaimReason(claimRaw) === 'already_sent') return 'already_sent'
      return 'skipped'
    }

    const auth = await loadAuthEmailConfirmed(admin, uid)
    if (!auth) {
      await releaseInFlight(admin, uid, ctx.stage, 'recipient_email_missing_or_unconfirmed')
      return 'failed'
    }

    const hasApp = await userHasAnyVerificationApplication(admin, uid)
    const legacy = await userHasLegacyVerificationDocsOnly(admin, uid)

    if (hasApp) {
      await releaseInFlight(admin, uid, ctx.stage, 'verification_application_exists')
      return 'skipped'
    }

    if (legacy) {
      await releaseInFlight(admin, uid, ctx.stage, 'legacy_verification_docs_only')
      return 'skipped'
    }

    const ready = await assertAuthoritativeRegistrationReminderSendReady(admin, {
      userId: uid,
      stage: ctx.stage,
      emailConfirmedAt: auth.emailConfirmedAt,
      eligibleAfterMs: ctx.eligibleAfterMs,
      hasAnyVerificationApplication: false,
      hasLegacyVerificationDocsOnly: false,
    })

    if (!ready.ok) {
      await releaseInFlight(admin, uid, ctx.stage, ready.reason)
      return 'skipped'
    }

    const result = await sendRegistrationReminderEmailToRecipient(auth.email, ctx.stage)

    if (result.ok) {
      const { error: markErr } = await admin.rpc('mark_registration_reminder_email_sent', {
        p_user_id: uid,
        p_reminder_stage: ctx.stage,
      })
      if (markErr) {
        console.warn('[registration-reminder] mark failed', {
          stage: ctx.stage,
          message: markErr.message,
        })
      }
      ctx.runGuard?.sentUserIdsThisRun.add(uid)
      return 'sent'
    }

    const errMsg = result.skipped ? 'registration_reminder_email_not_configured' : result.error
    await releaseInFlight(admin, uid, ctx.stage, errMsg)
    return 'failed'
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unknown'
    console.warn('[registration-reminder] unexpected', { stage: ctx.stage, message: msg })
    try {
      await releaseInFlight(admin, uid, ctx.stage, msg)
    } catch {
      /* ignore */
    }
    return 'failed'
  }
}

export async function countRegistrationRemindersSentTodayUtc(admin: SupabaseClient): Promise<number> {
  const dayStart = new Date(
    Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate()),
  ).toISOString()

  const { count, error } = await admin
    .from('registration_reminder_email_deliveries')
    .select('user_id', { count: 'exact', head: true })
    .not('sent_at', 'is', null)
    .gte('sent_at', dayStart)

  if (error) {
    console.warn('[registration-reminder] sent today count failed', { message: error.message })
    return REGISTRATION_REMINDER_DAILY_SEND_CAP
  }
  return count ?? 0
}

export async function countRegistrationRemindersSentThisMonthUtc(
  admin: SupabaseClient,
): Promise<number> {
  const monthStart = utcMonthStartIso()

  const { count, error } = await admin
    .from('registration_reminder_email_deliveries')
    .select('user_id', { count: 'exact', head: true })
    .not('sent_at', 'is', null)
    .gte('sent_at', monthStart)

  if (error) {
    console.warn('[registration-reminder] sent month count failed', { message: error.message })
    return REGISTRATION_REMINDER_MONTHLY_SEND_CAP
  }
  return count ?? 0
}

export async function retryPendingRegistrationReminderEmails(
  admin: SupabaseClient,
  params: {
    limit: number
    eligibleAfterMs: number
    runGuard: RegistrationReminderRunGuard
    submittedUserIds: Set<string>
    legacyUserIds: Set<string>
  },
): Promise<{ sentByStage: Record<RegistrationReminderStage, number>; failed: number }> {
  const sentByStage: Record<RegistrationReminderStage, number> = { 1: 0, 2: 0, 3: 0 }
  if (params.limit <= 0) return { sentByStage, failed: 0 }

  const { data, error } = await admin
    .from('registration_reminder_email_deliveries')
    .select('user_id')
    .is('sent_at', null)
    .limit(Math.max(params.limit * 20, 100))

  if (error || !data?.length) return { sentByStage, failed: 0 }

  const pendingUserIds: string[] = []
  const seen = new Set<string>()
  for (const row of data) {
    const uid = typeof row.user_id === 'string' ? row.user_id : ''
    if (!uid || seen.has(uid)) continue
    seen.add(uid)
    pendingUserIds.push(uid)
  }

  let remaining = params.limit
  let failed = 0

  for (const uid of pendingUserIds) {
    if (remaining <= 0) break
    if (params.runGuard.sentUserIdsThisRun.has(uid)) continue

    if (params.submittedUserIds.has(uid)) continue
    if (params.legacyUserIds.has(uid)) continue

    const auth = await loadAuthEmailConfirmed(admin, uid)
    if (!auth) continue

    const hasApp = await userHasAnyVerificationApplication(admin, uid)
    const legacy = await userHasLegacyVerificationDocsOnly(admin, uid)
    if (hasApp || legacy) continue

    const sentStages = await loadRegistrationReminderSentStages(admin, uid)
    const stage = pickEarliestUnsentEligibleRegistrationReminderStage({
      sentStages,
      emailConfirmedAt: auth.emailConfirmedAt,
      eligibleAfterMs: params.eligibleAfterMs,
      hasAnyVerificationApplication: false,
      hasLegacyVerificationDocsOnly: false,
    })
    if (!stage) continue

    const outcome = await deliverRegistrationReminderEmailIfNeeded(admin, uid, {
      stage,
      emailConfirmedAt: auth.emailConfirmedAt,
      eligibleAfterMs: params.eligibleAfterMs,
      hasAnyVerificationApplication: false,
      hasLegacyVerificationDocsOnly: false,
      runGuard: params.runGuard,
    })

    if (outcome === 'sent') {
      sentByStage[stage] += 1
      remaining -= 1
    } else if (outcome === 'failed') {
      failed += 1
    }
  }

  return { sentByStage, failed }
}
