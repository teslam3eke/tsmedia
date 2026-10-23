import type { SupabaseClient } from '@supabase/supabase-js'
import { reviewTextProfile } from './textProfileReview.js'
import { checkMemberEligibilityForAutoReview } from './verificationMemberEligibility.js'
import {
  buildAutoTextRejectReviewerNote,
  messageForAutoTextRejectPreset,
  AUTO_TEXT_REJECT_NOTE_PREFIX,
  parseAutoTextRejectPresetId,
  userMessageFromAutoRejectNote,
} from './verificationRejectPresetMessages.js'
import type { AutoTextRejectPresetId } from './verificationRejectPresetMessages.js'
import {
  runApproveVerificationApplication,
  runRejectVerificationApplication,
} from './verificationApplicationReview.js'
import { sendVerificationReviewPush } from './verificationReviewPush.js'

export type AutoReviewPublicOutcome =
  | 'approved'
  | 'text_rejected'
  | 'manual_queue'
  | 'manual_required'
  | 'already_approved'
  | 'skipped'

export type AutoReviewPublicPayload = {
  outcome: AutoReviewPublicOutcome
  /** 使用者可讀退件／狀態說明 */
  message?: string
  presetId?: AutoTextRejectPresetId
  fields?: ('bio' | 'questionnaire')[]
  applicationId: string
}

type ProfileRow = {
  id: string
  verification_status: string | null
  verification_text_auto_strikes?: number | null
  name: string | null
  gender: string | null
  company: string | null
  bio: string | null
  questionnaire: unknown
  photo_urls: string[] | null
  age: number | null
}

const MANUAL_QUEUE_NOTE = '自動審核：內容仍不符合規範，已轉人工審核。'

async function loadProfile(admin: SupabaseClient, userId: string): Promise<ProfileRow | null> {
  const { data, error } = await admin
    .from('profiles')
    .select(
      'id, verification_status, verification_text_auto_strikes, name, gender, company, age, bio, questionnaire, photo_urls',
    )
    .eq('id', userId)
    .maybeSingle()
  if (error || !data) return null
  return data as ProfileRow
}

async function countAutoTextRejectsFallback(admin: SupabaseClient, userId: string): Promise<number> {
  const { count, error } = await admin
    .from('verification_applications')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('status', 'rejected')
    .like('reviewer_note', `${AUTO_TEXT_REJECT_NOTE_PREFIX}%`)
  if (error) return 0
  return count ?? 0
}

async function resolveTextAutoStrikes(admin: SupabaseClient, profile: ProfileRow): Promise<number> {
  if (typeof profile.verification_text_auto_strikes === 'number') {
    return Math.max(0, profile.verification_text_auto_strikes)
  }
  return countAutoTextRejectsFallback(admin, profile.id)
}

async function incrementTextAutoStrikes(admin: SupabaseClient, userId: string): Promise<void> {
  const profile = await loadProfile(admin, userId)
  if (!profile) return
  if (typeof profile.verification_text_auto_strikes === 'number') {
    const next = Math.min(32767, profile.verification_text_auto_strikes + 1)
    await admin.from('profiles').update({ verification_text_auto_strikes: next }).eq('id', userId)
    return
  }
  /* 無 migration 169 欄位時，退件 note 前綴已足供 countAutoTextRejectsFallback */
}

async function resetTextAutoStrikes(admin: SupabaseClient, userId: string): Promise<void> {
  await admin.from('profiles').update({ verification_text_auto_strikes: 0 }).eq('id', userId)
}

async function claimAutoReview(
  admin: SupabaseClient,
  applicationId: string,
): Promise<{ ok: true } | { ok: false; reason: 'not_pending' | 'already_claimed' | 'missing' }> {
  const { data: app, error } = await admin
    .from('verification_applications')
    .select('id, status, auto_review_claimed_at, auto_review_outcome')
    .eq('id', applicationId)
    .maybeSingle()
  if (error || !app) return { ok: false, reason: 'missing' }
  if (app.status !== 'pending') return { ok: false, reason: 'not_pending' }
  if (app.auto_review_outcome) {
    return { ok: false, reason: 'already_claimed' }
  }

  const now = new Date().toISOString()
  const { data: claimed, error: claimErr } = await admin
    .from('verification_applications')
    .update({ auto_review_claimed_at: now })
    .eq('id', applicationId)
    .eq('status', 'pending')
    .is('auto_review_outcome', null)
    .is('auto_review_claimed_at', null)
    .select('id')
    .maybeSingle()

  if (claimErr || !claimed) return { ok: false, reason: 'already_claimed' }
  return { ok: true }
}

async function finishAutoReviewRecord(
  admin: SupabaseClient,
  applicationId: string,
  outcome: string,
): Promise<void> {
  await admin
    .from('verification_applications')
    .update({
      auto_review_outcome: outcome,
      auto_review_finished_at: new Date().toISOString(),
    })
    .eq('id', applicationId)
}

async function escalateToManualQueue(
  admin: SupabaseClient,
  applicationId: string,
  userId: string,
): Promise<AutoReviewPublicPayload> {
  await admin
    .from('verification_applications')
    .update({ reviewer_note: MANUAL_QUEUE_NOTE })
    .eq('id', applicationId)
    .eq('status', 'pending')

  await admin
    .from('profiles')
    .update({ verification_status: 'submitted' })
    .eq('id', userId)

  await finishAutoReviewRecord(admin, applicationId, 'manual_queue')

  return {
    outcome: 'manual_queue',
    message: MANUAL_QUEUE_NOTE,
    applicationId,
  }
}

async function escalateUncertainToManual(
  admin: SupabaseClient,
  applicationId: string,
  userId: string,
  detail: string,
): Promise<AutoReviewPublicPayload> {
  const note = `自動審核無法確認（${detail}），已轉人工。`
  await admin
    .from('verification_applications')
    .update({ reviewer_note: note })
    .eq('id', applicationId)
    .eq('status', 'pending')
  await admin.from('profiles').update({ verification_status: 'submitted' }).eq('id', userId)
  await finishAutoReviewRecord(admin, applicationId, 'manual_required')
  return { outcome: 'manual_required', message: note, applicationId }
}

export async function runVerificationAutoReviewAfterSubmit(
  admin: SupabaseClient,
  applicationId: string,
): Promise<AutoReviewPublicPayload> {
  const appId = applicationId.trim()
  const { data: app, error: appErr } = await admin
    .from('verification_applications')
    .select('id, user_id, status, auto_review_outcome')
    .eq('id', appId)
    .maybeSingle()

  if (appErr || !app) {
    return { outcome: 'manual_required', message: '找不到申請。', applicationId: appId }
  }

  if (app.auto_review_outcome === 'approved') {
    return { outcome: 'approved', applicationId: appId }
  }
  if (app.auto_review_outcome === 'text_rejected') {
    const { data: row } = await admin
      .from('verification_applications')
      .select('reviewer_note')
      .eq('id', appId)
      .maybeSingle()
    const presetId = parseAutoTextRejectPresetId(row?.reviewer_note ?? null) ?? undefined
    return {
      outcome: 'text_rejected',
      applicationId: appId,
      presetId,
      message: presetId ? messageForAutoTextRejectPreset(presetId) : undefined,
    }
  }
  if (app.auto_review_outcome === 'manual_queue' || app.auto_review_outcome === 'manual_required') {
    return { outcome: app.auto_review_outcome as AutoReviewPublicOutcome, applicationId: appId }
  }

  if (app.status !== 'pending') {
    return { outcome: 'skipped', applicationId: appId }
  }

  const claim = await claimAutoReview(admin, appId)
  if (!claim.ok) {
    if (claim.reason === 'already_claimed') {
      const { data: again } = await admin
        .from('verification_applications')
        .select('auto_review_outcome, reviewer_note')
        .eq('id', appId)
        .maybeSingle()
      if (again?.auto_review_outcome === 'approved') return { outcome: 'approved', applicationId: appId }
      if (again?.auto_review_outcome === 'text_rejected') {
        return {
          outcome: 'text_rejected',
          applicationId: appId,
          message: userMessageFromAutoRejectNote(again.reviewer_note) ?? undefined,
        }
      }
      return { outcome: 'manual_queue', applicationId: appId }
    }
    return { outcome: 'skipped', applicationId: appId }
  }

  const userId = app.user_id as string
  const profile = await loadProfile(admin, userId)
  if (!profile) {
    return escalateUncertainToManual(admin, appId, userId, 'profile_missing')
  }

  if (profile.verification_status === 'approved') {
    await finishAutoReviewRecord(admin, appId, 'already_approved')
    return { outcome: 'already_approved', applicationId: appId }
  }

  const member = checkMemberEligibilityForAutoReview(profile)
  if (!member.ok) {
    if (member.detail === 'already_approved') {
      await finishAutoReviewRecord(admin, appId, 'already_approved')
      return { outcome: 'already_approved', applicationId: appId }
    }
    if (member.uncertain) {
      return escalateUncertainToManual(admin, appId, userId, member.detail)
    }
    const note = buildAutoTextRejectReviewerNote(member.presetId)
    await runRejectVerificationApplication(admin, appId, note)
    await finishAutoReviewRecord(admin, appId, 'text_rejected')
    return {
      outcome: 'text_rejected',
      presetId: member.presetId,
      message: messageForAutoTextRejectPreset(member.presetId),
      applicationId: appId,
    }
  }

  const text = reviewTextProfile(profile.bio, profile.questionnaire)
  if (text.verdict === 'NEEDS_EDIT' && text.presetId) {
    const strikes = await resolveTextAutoStrikes(admin, profile)
    if (strikes >= 1) {
      await finishAutoReviewRecord(admin, appId, 'manual_queue')
      return escalateToManualQueue(admin, appId, userId)
    }

    const note = buildAutoTextRejectReviewerNote(text.presetId)
    const reject = await runRejectVerificationApplication(admin, appId, note)
    if (!reject.ok) {
      return escalateUncertainToManual(admin, appId, userId, reject.error ?? 'reject_failed')
    }
    await incrementTextAutoStrikes(admin, userId)
    await finishAutoReviewRecord(admin, appId, 'text_rejected')
    return {
      outcome: 'text_rejected',
      presetId: text.presetId,
      message: messageForAutoTextRejectPreset(text.presetId),
      fields: text.fields,
      applicationId: appId,
    }
  }

  const approve = await runApproveVerificationApplication(admin, appId, { approveIncome: false })
  if (!approve.ok) {
    return escalateUncertainToManual(admin, appId, userId, approve.error ?? 'approve_failed')
  }

  await resetTextAutoStrikes(admin, userId)
  await finishAutoReviewRecord(admin, appId, 'approved')

  return { outcome: 'approved', applicationId: appId }
}
