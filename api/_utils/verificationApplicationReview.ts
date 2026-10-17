import type { SupabaseClient } from '@supabase/supabase-js'
import { deliverApprovalEmailIfNeeded } from './deliverApprovalEmailIfNeeded.js'
import { sendVerificationReviewPush } from './verificationReviewPush.js'

type VerificationDocRow = {
  id: string
  verification_kind: string | null
  claimed_income_tier: string | null
  doc_url: string | null
}

type ApplicationRow = {
  id: string
  user_id: string
  status: string
  docs: VerificationDocRow[]
}

function normalizeProofStoragePath(path: string): string {
  return path.replace(/^\/+/, '').trim()
}

async function deleteProofDocsFromStorage(admin: SupabaseClient, paths: string[]): Promise<boolean> {
  const normalized = paths.map(normalizeProofStoragePath).filter(Boolean)
  if (normalized.length === 0) return true
  const { error } = await admin.storage.from('proofs').remove(normalized)
  if (error) {
    console.warn('[verification-review] storage remove failed', { message: error.message })
    return false
  }
  return true
}

async function loadApplication(admin: SupabaseClient, applicationId: string): Promise<ApplicationRow | null> {
  const { data: app, error: appErr } = await admin
    .from('verification_applications')
    .select('id, user_id, status')
    .eq('id', applicationId)
    .maybeSingle()
  if (appErr || !app) return null

  const { data: docs } = await admin
    .from('verification_docs')
    .select('id, verification_kind, claimed_income_tier, doc_url')
    .eq('application_id', applicationId)

  return {
    id: app.id as string,
    user_id: app.user_id as string,
    status: app.status as string,
    docs: (docs ?? []) as VerificationDocRow[],
  }
}

export type ApproveApplicationResult = {
  ok: boolean
  error?: string
  pushSent?: number
  pushFailed?: number
  alreadyApproved?: boolean
}

export async function runApproveVerificationApplication(
  admin: SupabaseClient,
  applicationId: string,
  opts?: { reviewerNote?: string | null; skipIncome?: boolean },
): Promise<ApproveApplicationResult> {
  const application = await loadApplication(admin, applicationId)
  if (!application) return { ok: false, error: '找不到審核申請。' }

  if (application.status === 'approved') {
    await deliverApprovalEmailIfNeeded(admin, applicationId)
    return { ok: true, alreadyApproved: true, pushSent: 0, pushFailed: 0 }
  }

  if (application.status !== 'pending') {
    return { ok: false, error: '此申請已無法通過審核。' }
  }

  const reviewedAt = new Date().toISOString()
  const reviewerNote = opts?.reviewerNote ?? null
  const skipIncome = opts?.skipIncome === true
  const incomeDocs = application.docs.filter((d) => d.verification_kind === 'income')
  const incomeDoc = incomeDocs.find((d) => d.claimed_income_tier)
  const nonIncomeDocIds = application.docs
    .filter((d) => d.verification_kind !== 'income')
    .map((d) => d.id)
  const incomeDocIds = incomeDocs.map((d) => d.id)
  const incomeSkipNote = '收入皇冠認證未通過；會員審核已通過。'

  const { error: appError } = await admin
    .from('verification_applications')
    .update({
      status: 'approved',
      reviewed_at: reviewedAt,
      reviewer_note:
        skipIncome && incomeDocIds.length > 0
          ? (reviewerNote ?? '會員審核通過；收入皇冠未核可')
          : reviewerNote,
    })
    .eq('id', applicationId)
    .eq('status', 'pending')

  if (appError) {
    console.warn('[verification-review] app update failed', { message: appError.message })
    return { ok: false, error: appError.message }
  }

  if (nonIncomeDocIds.length > 0) {
    const { error: docsError } = await admin
      .from('verification_docs')
      .update({ status: 'approved', reviewed_at: reviewedAt, reviewer_note: reviewerNote })
      .in('id', nonIncomeDocIds)
    if (docsError) return { ok: false, error: docsError.message }
  }

  if (skipIncome && incomeDocIds.length > 0) {
    const { error: incomeRejectError } = await admin
      .from('verification_docs')
      .update({
        status: 'rejected',
        reviewed_at: reviewedAt,
        reviewer_note: incomeSkipNote,
      })
      .in('id', incomeDocIds)
    if (incomeRejectError) return { ok: false, error: incomeRejectError.message }
  } else if (incomeDocIds.length > 0) {
    const { error: incomeApproveError } = await admin
      .from('verification_docs')
      .update({ status: 'approved', reviewed_at: reviewedAt, reviewer_note: reviewerNote })
      .in('id', incomeDocIds)
    if (incomeApproveError) return { ok: false, error: incomeApproveError.message }
  }

  const profilePatch: Record<string, unknown> = {
    is_verified: true,
    verification_status: 'approved',
  }
  if (!skipIncome && incomeDoc?.claimed_income_tier) {
    profilePatch.income_tier = incomeDoc.claimed_income_tier
  }

  const { error: profileError } = await admin
    .from('profiles')
    .update(profilePatch)
    .eq('id', application.user_id)
  if (profileError) return { ok: false, error: profileError.message }

  const paths = application.docs.map((d) => d.doc_url).filter(Boolean) as string[]
  const deleted = await deleteProofDocsFromStorage(admin, paths)
  if (paths.length > 0 && deleted) {
    await admin.from('verification_docs').update({ doc_url: null }).eq('application_id', applicationId)
  }

  const bodyParts = ['你的會員審核已通過。']
  if (skipIncome && incomeDocIds.length > 0) {
    bodyParts.push('收入皇冠認證未通過；若日後有合適文件，可重新申請皇冠。')
  } else if (incomeDoc?.claimed_income_tier) {
    bodyParts.push('收入皇冠認證已一併通過，可到編輯個人資訊開啟皇冠顯示。')
  }

  const push = await sendVerificationReviewPush(admin, {
    userId: application.user_id,
    kind: 'verification_approved',
    title: '會員審核已通過',
    body: bodyParts.join(''),
  })

  try {
    await deliverApprovalEmailIfNeeded(admin, applicationId)
  } catch (e) {
    console.warn('[verification-review] approval email failed', {
      applicationId,
      message: e instanceof Error ? e.message : 'unknown',
    })
  }

  return {
    ok: true,
    pushSent: push.sent,
    pushFailed: push.failed,
    ...(push.sent > 0 ? {} : { error: push.error ?? '推播未確認送達' }),
  }
}

export async function runRejectVerificationApplication(
  admin: SupabaseClient,
  applicationId: string,
  reviewerNote?: string | null,
): Promise<ApproveApplicationResult> {
  const application = await loadApplication(admin, applicationId)
  if (!application) return { ok: false, error: '找不到審核申請。' }
  if (application.status !== 'pending') {
    return { ok: false, error: '此申請已無法退件。' }
  }

  const reviewedAt = new Date().toISOString()
  const note = reviewerNote ?? null

  const { error: appError } = await admin
    .from('verification_applications')
    .update({ status: 'rejected', reviewed_at: reviewedAt, reviewer_note: note })
    .eq('id', applicationId)
    .eq('status', 'pending')
  if (appError) return { ok: false, error: appError.message }

  const { error: docsError } = await admin
    .from('verification_docs')
    .update({ status: 'rejected', reviewed_at: reviewedAt, reviewer_note: note })
    .eq('application_id', applicationId)
  if (docsError) return { ok: false, error: docsError.message }

  await admin
    .from('profiles')
    .update({ is_verified: false, verification_status: 'rejected' })
    .eq('id', application.user_id)

  const reason = note?.trim()
  const rejectBody = reason
    ? `退件原因：${reason}。你的個人資料與生活照已保留，請修正證件後重新送審。`
    : '審核未通過。你的個人資料與生活照已保留，請修正證件後重新送審。'

  const push = await sendVerificationReviewPush(admin, {
    userId: application.user_id,
    kind: 'verification_rejected',
    title: '會員審核未通過',
    body: rejectBody,
  })

  return {
    ok: true,
    pushSent: push.sent,
    pushFailed: push.failed,
    ...(push.sent > 0 ? {} : { error: push.error }),
  }
}
