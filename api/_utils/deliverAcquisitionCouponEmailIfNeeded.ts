import type { SupabaseClient } from '@supabase/supabase-js'
import type { UserCouponCampaignKey } from './membershipCheckoutPricing.js'
import {
  isLifecycleAcquisitionCampaignKey,
  sendAcquisitionCouponEmailToRecipient,
} from './acquisitionCouponEmailSend.js'

type ClaimRow = {
  entitlementId: string
  userId: string
  campaignKey: UserCouponCampaignKey
}

type EntitlementRow = {
  id: string
  user_id: string
  campaign_key: string
  expires_at: string
  status: string
}

function parseClaim(data: unknown): ClaimRow | null {
  if (!data || typeof data !== 'object') return null
  const o = data as Record<string, unknown>
  if (o.ok !== true) return null
  const entitlementId = typeof o.entitlement_id === 'string' ? o.entitlement_id : ''
  const userId = typeof o.user_id === 'string' ? o.user_id : ''
  const campaignKey = typeof o.campaign_key === 'string' ? o.campaign_key : ''
  if (!entitlementId || !userId || !isLifecycleAcquisitionCampaignKey(campaignKey)) return null
  return { entitlementId, userId, campaignKey }
}

export async function userHasEverPaidVipMembership(
  admin: SupabaseClient,
  userId: string,
): Promise<boolean> {
  const { data, error } = await admin.rpc('user_has_ever_paid_vip_membership', {
    p_user_id: userId,
  })
  if (error) {
    console.warn('[acquisition-coupon-email] paid check failed', { userId, message: error.message })
    return true
  }
  return data === true
}

async function loadEntitlement(
  admin: SupabaseClient,
  entitlementId: string,
): Promise<EntitlementRow | null> {
  const { data, error } = await admin
    .from('user_coupon_entitlements')
    .select('id, user_id, campaign_key, expires_at, status')
    .eq('id', entitlementId)
    .maybeSingle()

  if (error || !data) return null
  return data as EntitlementRow
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

function entitlementEligibleForFirstEmail(row: EntitlementRow): boolean {
  if (!isLifecycleAcquisitionCampaignKey(row.campaign_key)) return false
  if (row.status !== 'available') return false
  const expiresMs = new Date(row.expires_at).getTime()
  if (!Number.isFinite(expiresMs) || expiresMs <= Date.now()) return false
  return true
}

/** Acquisition coupon Email；永不 throw。coupon 已過期或已 paid 不寄首次信。 */
export async function deliverAcquisitionCouponEmailIfNeeded(
  admin: SupabaseClient,
  entitlementId: string,
): Promise<void> {
  const entId = entitlementId.trim()
  if (!entId) return

  try {
    const ent = await loadEntitlement(admin, entId)
    if (!ent) return

    if (await userHasEverPaidVipMembership(admin, ent.user_id)) return
    if (!entitlementEligibleForFirstEmail(ent)) return

    const { data: claimRaw, error: claimErr } = await admin.rpc(
      'claim_acquisition_coupon_email_delivery',
      { p_entitlement_id: entId },
    )
    if (claimErr) {
      console.warn('[acquisition-coupon-email] claim failed', {
        entitlementId: entId,
        message: claimErr.message,
      })
      return
    }

    const row = parseClaim(claimRaw)
    if (!row) return

    const email = await loadAuthEmail(admin, row.userId)
    if (!email) {
      await admin.rpc('release_acquisition_coupon_email_in_flight', {
        p_entitlement_id: entId,
        p_error: 'recipient_email_missing',
      })
      return
    }

    const result = await sendAcquisitionCouponEmailToRecipient(email, row.campaignKey)

    if (result.ok) {
      const { error: markErr } = await admin.rpc('mark_acquisition_coupon_email_sent', {
        p_entitlement_id: entId,
      })
      if (markErr) {
        console.warn('[acquisition-coupon-email] mark failed', {
          entitlementId: entId,
          message: markErr.message,
        })
      }
      return
    }

    const errMsg = result.skipped ? 'acquisition_coupon_email_not_configured' : result.error
    await admin.rpc('release_acquisition_coupon_email_in_flight', {
      p_entitlement_id: entId,
      p_error: errMsg,
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unknown'
    console.warn('[acquisition-coupon-email] unexpected', { entitlementId: entId, message: msg })
    try {
      await admin.rpc('release_acquisition_coupon_email_in_flight', {
        p_entitlement_id: entId,
        p_error: msg,
      })
    } catch {
      /* ignore */
    }
  }
}

/** Cron retry：已 issue、尚未 sent；deliver 內再檢查 paid / 過期。 */
export async function retryPendingAcquisitionCouponEmails(
  admin: SupabaseClient,
  limit = 50,
): Promise<number> {
  const { data, error } = await admin
    .from('acquisition_coupon_email_deliveries')
    .select('entitlement_id')
    .is('sent_at', null)
    .order('last_attempt_at', { ascending: true, nullsFirst: true })
    .limit(limit)

  if (error || !data?.length) return 0

  for (const row of data) {
    const entId = typeof row.entitlement_id === 'string' ? row.entitlement_id : ''
    if (entId) await deliverAcquisitionCouponEmailIfNeeded(admin, entId)
  }
  return data.length
}
