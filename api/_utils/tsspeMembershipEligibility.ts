import type { SupabaseClient } from '@supabase/supabase-js'
import {
  TSSPE_DISCOUNT_NTD,
  TSSPE_MEMBERSHIP_DISCOUNT_CODE,
  readTsspeGoLiveMsWithOverride,
} from './tsspeConfig.js'
import { applyFixedMembershipDiscount } from './membershipDiscount.js'
import type { ResolvedMaleMembershipDiscount } from './membershipDiscount.js'

export class TsspeMembershipEligibilityError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'TSSPE_NOT_CONFIGURED'
      | 'TSSPE_NOT_ELIGIBLE'
      | 'TSSPE_RPC_FAILED',
  ) {
    super(message)
    this.name = 'TsspeMembershipEligibilityError'
  }
}

export function isTsspeMembershipDiscountCode(raw: unknown): boolean {
  return typeof raw === 'string' && raw.trim().toUpperCase() === TSSPE_MEMBERSHIP_DISCOUNT_CODE
}

type CheckoutProfileGate = {
  gender: string | null | undefined
  verification_status: string | null | undefined
  account_status: string | null | undefined
}

export function assertTsspeCheckoutProfileGate(profile: CheckoutProfileGate): void {
  if (profile.gender !== 'male') {
    throw new TsspeMembershipEligibilityError('TSSPE_NOT_ELIGIBLE', 'TSSPE_NOT_ELIGIBLE')
  }
  if (profile.verification_status !== 'approved' || profile.account_status !== 'active') {
    throw new TsspeMembershipEligibilityError('TSSPE_NOT_ELIGIBLE', 'TSSPE_NOT_ELIGIBLE')
  }
}

export async function assertTsspeRegistrationReminderStage2Proof(
  admin: SupabaseClient,
  userId: string,
  goLiveOverrideIso?: string | null,
): Promise<void> {
  const goLiveMs = readTsspeGoLiveMsWithOverride(goLiveOverrideIso)
  if (goLiveMs === null) {
    throw new TsspeMembershipEligibilityError('TSSPE_NOT_CONFIGURED', 'TSSPE_NOT_CONFIGURED')
  }

  const { data, error } = await admin
    .from('registration_reminder_email_deliveries')
    .select('sent_at')
    .eq('user_id', userId)
    .eq('reminder_stage', 2)
    .maybeSingle()

  if (error) {
    throw new TsspeMembershipEligibilityError('TSSPE_RPC_FAILED', 'TSSPE_RPC_FAILED')
  }

  const sentAt = data?.sent_at
  if (!sentAt) {
    throw new TsspeMembershipEligibilityError('TSSPE_NOT_ELIGIBLE', 'TSSPE_NOT_ELIGIBLE')
  }

  const sentMs = new Date(String(sentAt)).getTime()
  if (!Number.isFinite(sentMs) || sentMs < goLiveMs) {
    throw new TsspeMembershipEligibilityError('TSSPE_NOT_ELIGIBLE', 'TSSPE_NOT_ELIGIBLE')
  }
}

export async function assertUserNeverPaidVipForTsspe(
  admin: SupabaseClient,
  userId: string,
): Promise<void> {
  const { data, error } = await admin.rpc('user_has_ever_paid_vip_membership', {
    p_user_id: userId,
  })
  if (error) {
    throw new TsspeMembershipEligibilityError('TSSPE_RPC_FAILED', 'TSSPE_RPC_FAILED')
  }
  if (data) {
    throw new TsspeMembershipEligibilityError('TSSPE_NOT_ELIGIBLE', 'TSSPE_NOT_ELIGIBLE')
  }
}

export async function resolveTsspeMaleMembershipDiscount(
  admin: SupabaseClient,
  params: {
    userId: string
    profile: CheckoutProfileGate
    promoBasePriceNtd: number
    goLiveOverrideIso?: string | null
  },
): Promise<ResolvedMaleMembershipDiscount> {
  assertTsspeCheckoutProfileGate(params.profile)
  await assertTsspeRegistrationReminderStage2Proof(admin, params.userId, params.goLiveOverrideIso)
  await assertUserNeverPaidVipForTsspe(admin, params.userId)

  return {
    code: TSSPE_MEMBERSHIP_DISCOUNT_CODE,
    discountNtd: TSSPE_DISCOUNT_NTD,
    finalPriceNtd: applyFixedMembershipDiscount(params.promoBasePriceNtd, TSSPE_DISCOUNT_NTD),
  }
}
