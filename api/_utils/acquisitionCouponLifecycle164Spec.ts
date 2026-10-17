/**
 * Migration 164 lifecycle 規格鏡像（供 vitest；authoritative 行為在 SQL issue_acquisition_coupon_entitlement_v2）。
 */

export const LIFECYCLE_CAMPAIGN_48H = 'APPROVED_48H_200'
export const LIFECYCLE_CAMPAIGN_7D = 'APPROVED_7D_30PCT'

export const COUPON_ENTITLEMENT_TTL_MS = 48 * 60 * 60 * 1000

export type SimEntitlement = {
  id: string
  userId: string
  campaignKey: string
  issuedAtMs: number
  expiresAtMs: number
  status: 'available' | 'reserved' | 'redeemed' | 'cancelled' | 'reconciliation_required'
}

export type SimProfile = {
  userId: string
  gender: 'male' | 'female'
  verificationStatus: 'pending' | 'approved' | 'rejected'
  anchorAtMs: number | null
  everPaidVip: boolean
}

export type SimEmailDelivery = {
  entitlementId: string
  sentAtMs: number | null
  attempts: number
  inFlightUntilMs: number | null
}

export type IssueResult =
  | { ok: true; alreadyExisted: boolean; entitlement: SimEntitlement }
  | { ok: false; code: string }

export function lifecycleWindowMet(
  campaignKey: string,
  anchorAtMs: number,
  nowMs: number,
): boolean {
  if (campaignKey === LIFECYCLE_CAMPAIGN_48H) {
    return nowMs >= anchorAtMs + 48 * 60 * 60 * 1000
  }
  if (campaignKey === LIFECYCLE_CAMPAIGN_7D) {
    return nowMs >= anchorAtMs + 7 * 24 * 60 * 60 * 1000
  }
  return false
}

export function expiresAtForIssue(issuedAtMs: number): number {
  return issuedAtMs + COUPON_ENTITLEMENT_TTL_MS
}

export class Lifecycle164Simulator {
  entitlements: SimEntitlement[] = []
  profiles = new Map<string, SimProfile>()
  emailDeliveries = new Map<string, SimEmailDelivery>()
  private seq = 0

  upsertProfile(p: SimProfile) {
    this.profiles.set(p.userId, p)
  }

  issueV2(userId: string, campaignKey: string, nowMs: number): IssueResult {
    const existing = this.entitlements.find(
      (e) => e.userId === userId && e.campaignKey === campaignKey,
    )
    if (existing) {
      return { ok: true, alreadyExisted: true, entitlement: { ...existing } }
    }

    const profile = this.profiles.get(userId)
    if (!profile) return { ok: false, code: 'PROFILE_NOT_FOUND' }
    if (profile.gender !== 'male') return { ok: false, code: 'COUPON_MALE_ONLY' }
    if (profile.verificationStatus !== 'approved') {
      return { ok: false, code: 'COUPON_LIFECYCLE_NOT_APPROVED' }
    }
    if (profile.anchorAtMs == null) return { ok: false, code: 'COUPON_LIFECYCLE_ANCHOR_MISSING' }
    if (profile.everPaidVip) return { ok: false, code: 'COUPON_NOT_FIRST_MEMBERSHIP_PURCHASE' }
    if (!lifecycleWindowMet(campaignKey, profile.anchorAtMs, nowMs)) {
      return { ok: false, code: 'COUPON_LIFECYCLE_TOO_EARLY' }
    }

    const issuedAtMs = nowMs
    const ent: SimEntitlement = {
      id: `ent-${++this.seq}`,
      userId,
      campaignKey,
      issuedAtMs,
      expiresAtMs: expiresAtForIssue(issuedAtMs),
      status: 'available',
    }
    this.entitlements.push(ent)
    return { ok: true, alreadyExisted: false, entitlement: ent }
  }

  claimEmail(entitlementId: string, nowMs: number): { ok: boolean; reason?: string } {
    const ent = this.entitlements.find((e) => e.id === entitlementId)
    if (!ent) return { ok: false, reason: 'entitlement_not_found' }

    let row = this.emailDeliveries.get(entitlementId)
    if (!row) {
      row = { entitlementId, sentAtMs: null, attempts: 0, inFlightUntilMs: null }
      this.emailDeliveries.set(entitlementId, row)
    }

    if (row.sentAtMs != null) return { ok: false, reason: 'already_sent' }
    if (row.inFlightUntilMs != null && row.inFlightUntilMs > nowMs) {
      return { ok: false, reason: 'in_flight' }
    }

    row.attempts += 1
    row.inFlightUntilMs = nowMs + 90_000
    return { ok: true }
  }

  markEmailSent(entitlementId: string, nowMs: number) {
    const row = this.emailDeliveries.get(entitlementId)
    if (!row) return
    row.sentAtMs = row.sentAtMs ?? nowMs
    row.inFlightUntilMs = null
  }
}
