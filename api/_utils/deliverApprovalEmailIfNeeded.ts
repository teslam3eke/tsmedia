import type { SupabaseClient } from '@supabase/supabase-js'
import { sendApprovalEmailToRecipient } from './approvalEmailSend.js'

type ClaimRow = {
  applicationId: string
  userId: string
}

function parseClaim(data: unknown): ClaimRow | null {
  if (!data || typeof data !== 'object') return null
  const o = data as Record<string, unknown>
  if (o.ok !== true) return null
  const applicationId = typeof o.application_id === 'string' ? o.application_id : ''
  const userId = typeof o.user_id === 'string' ? o.user_id : ''
  if (!applicationId || !userId) return null
  return { applicationId, userId }
}

async function loadAuthEmail(admin: SupabaseClient, userId: string): Promise<string | null> {
  try {
    const { data, error } = await admin.auth.admin.getUserById(userId)
    if (error || !data.user?.email) return null
    return data.user.email.trim() || null
  } catch {
    return null
  }
}

/** 審核通過後寄 Approval Email；永不 throw。 */
export async function deliverApprovalEmailIfNeeded(
  admin: SupabaseClient,
  applicationId: string,
): Promise<void> {
  const appId = applicationId.trim()
  if (!appId) return

  try {
    const { data: claimRaw, error: claimErr } = await admin.rpc(
      'claim_verification_approval_email_delivery',
      { p_application_id: appId },
    )
    if (claimErr) {
      console.warn('[approval-email] claim failed', { applicationId: appId, message: claimErr.message })
      return
    }

    const row = parseClaim(claimRaw)
    if (!row) return

    const email = await loadAuthEmail(admin, row.userId)
    if (!email) {
      await admin.rpc('release_verification_approval_email_in_flight', {
        p_application_id: appId,
        p_error: 'recipient_email_missing',
      })
      return
    }

    const result = await sendApprovalEmailToRecipient(email)

    if (result.ok) {
      const { error: markErr } = await admin.rpc('mark_verification_approval_email_sent', {
        p_application_id: appId,
      })
      if (markErr) {
        console.warn('[approval-email] mark failed', { applicationId: appId, message: markErr.message })
      }
      return
    }

    const errMsg = result.skipped ? 'approval_email_not_configured' : result.error
    await admin.rpc('release_verification_approval_email_in_flight', {
      p_application_id: appId,
      p_error: errMsg,
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unknown'
    console.warn('[approval-email] unexpected', { applicationId: appId, message: msg })
    try {
      await admin.rpc('release_verification_approval_email_in_flight', {
        p_application_id: appId,
        p_error: msg,
      })
    } catch {
      /* ignore */
    }
  }
}

/** Cron／手動 retry：已 approved 且尚未 sent 的 application。 */
export async function retryPendingApprovalEmails(admin: SupabaseClient, limit = 20): Promise<number> {
  const { data, error } = await admin
    .from('verification_applications')
    .select('id')
    .eq('status', 'approved')
    .is('approval_email_sent_at', null)
    .order('approval_email_last_attempt_at', { ascending: true, nullsFirst: true })
    .limit(limit)

  if (error || !data?.length) return 0

  for (const row of data) {
    const id = typeof row.id === 'string' ? row.id : ''
    if (id) await deliverApprovalEmailIfNeeded(admin, id)
  }
  return data.length
}
