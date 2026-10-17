import type { SupabaseClient } from '@supabase/supabase-js'
import {
  USER_COUPON_CAMPAIGN,
  type UserCouponCampaignKey,
} from './membershipCheckoutPricing.js'
import {
  deliverAcquisitionCouponEmailIfNeeded,
  retryPendingAcquisitionCouponEmails,
  userHasEverPaidVipMembership,
} from './deliverAcquisitionCouponEmailIfNeeded.js'

const LIFECYCLE_CAMPAIGNS: UserCouponCampaignKey[] = [
  USER_COUPON_CAMPAIGN.APPROVED_48H_200,
  USER_COUPON_CAMPAIGN.APPROVED_7D_30PCT,
]

export type IssueAcquisitionResult =
  | { kind: 'issued'; entitlementId: string; alreadyExisted: boolean }
  | { kind: 'skip' }
  | { kind: 'paid' }

export function parseIssueAcquisitionCouponRpc(data: unknown): IssueAcquisitionResult {
  if (!data || typeof data !== 'object') return { kind: 'skip' }
  const o = data as Record<string, unknown>
  if (o.ok !== true) return { kind: 'skip' }
  const entitlementId = typeof o.entitlement_id === 'string' ? o.entitlement_id : ''
  if (!entitlementId) return { kind: 'skip' }
  return {
    kind: 'issued',
    entitlementId,
    alreadyExisted: o.already_existed === true,
  }
}

export function isIssueRpcPaidOrIneligibleError(message: string): 'paid' | 'too_early' | 'other' {
  const m = message.toUpperCase()
  if (m.includes('COUPON_NOT_FIRST_MEMBERSHIP_PURCHASE')) return 'paid'
  if (m.includes('COUPON_LIFECYCLE_TOO_EARLY')) return 'too_early'
  return 'other'
}

export async function tryIssueAcquisitionCoupon(
  admin: SupabaseClient,
  userId: string,
  campaignKey: UserCouponCampaignKey,
): Promise<IssueAcquisitionResult> {
  const { data, error } = await admin.rpc('issue_acquisition_coupon_entitlement_v2', {
    p_user_id: userId,
    p_campaign_key: campaignKey,
  })

  if (error) {
    const kind = isIssueRpcPaidOrIneligibleError(error.message)
    if (kind === 'paid') return { kind: 'paid' }
    if (kind === 'too_early') return { kind: 'skip' }
    console.warn('[acquisition-lifecycle] issue failed', {
      userId,
      campaignKey,
      message: error.message,
    })
    return { kind: 'skip' }
  }

  return parseIssueAcquisitionCouponRpc(data)
}

export type AcquisitionLifecycleCronStats = {
  profilesScanned: number
  issuesAttempted: number
  issuesNew: number
  issuesAlreadyExisted: number
  emailsTriggered: number
  emailRetriesProcessed: number
  paidSkippedUsers: number
}

const PROFILE_PAGE_SIZE = 200
const MAX_PROFILE_PAGES = 20

/**
 * 每 6 小時 Cron：僅有 acquisition_lifecycle_anchor_at 的男性 approved 會員。
 * 不 backfill；不處理 anchor NULL 舊會員。
 */
export async function runAcquisitionCouponLifecycleCron(
  admin: SupabaseClient,
): Promise<AcquisitionLifecycleCronStats> {
  const stats: AcquisitionLifecycleCronStats = {
    profilesScanned: 0,
    issuesAttempted: 0,
    issuesNew: 0,
    issuesAlreadyExisted: 0,
    emailsTriggered: 0,
    emailRetriesProcessed: 0,
    paidSkippedUsers: 0,
  }

  const cutoff48h = new Date(Date.now() - 48 * 3600 * 1000).toISOString()

  for (let page = 0; page < MAX_PROFILE_PAGES; page += 1) {
    const from = page * PROFILE_PAGE_SIZE
    const to = from + PROFILE_PAGE_SIZE - 1

    const { data: profiles, error } = await admin
      .from('profiles')
      .select('id')
      .eq('gender', 'male')
      .eq('verification_status', 'approved')
      .not('acquisition_lifecycle_anchor_at', 'is', null)
      .lte('acquisition_lifecycle_anchor_at', cutoff48h)
      .order('acquisition_lifecycle_anchor_at', { ascending: true })
      .range(from, to)

    if (error) {
      console.warn('[acquisition-lifecycle] profile scan failed', { message: error.message })
      break
    }
    if (!profiles?.length) break

    for (const p of profiles) {
      const userId = typeof p.id === 'string' ? p.id : ''
      if (!userId) continue
      stats.profilesScanned += 1

      if (await userHasEverPaidVipMembership(admin, userId)) {
        stats.paidSkippedUsers += 1
        continue
      }

      for (const campaignKey of LIFECYCLE_CAMPAIGNS) {
        stats.issuesAttempted += 1
        const issue = await tryIssueAcquisitionCoupon(admin, userId, campaignKey)
        if (issue.kind === 'paid') {
          stats.paidSkippedUsers += 1
          break
        }
        if (issue.kind !== 'issued') continue

        if (issue.alreadyExisted) stats.issuesAlreadyExisted += 1
        else stats.issuesNew += 1

        await deliverAcquisitionCouponEmailIfNeeded(admin, issue.entitlementId)
        stats.emailsTriggered += 1
      }
    }

    if (profiles.length < PROFILE_PAGE_SIZE) break
  }

  stats.emailRetriesProcessed = await retryPendingAcquisitionCouponEmails(admin, 50)
  return stats
}
