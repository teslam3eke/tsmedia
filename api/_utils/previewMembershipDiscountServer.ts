import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchPublicPaymentPricing } from './pricingResolver.js'
import {
  TsspeMembershipEligibilityError,
  isTsspeMembershipDiscountCode,
  resolveTsspeMaleMembershipDiscount,
} from './tsspeMembershipEligibility.js'
import { normalizeMembershipDiscountCode } from './membershipDiscount.js'

/** 與 `preview_membership_discount_code` RPC JSON 對齊（read-only preview）。 */
export type PreviewMembershipDiscountPayload = {
  ok: boolean
  reason?: string
  benefit?: 'male_discount' | 'female_free'
  code?: string
  discount_ntd?: number
  base_price_ntd?: number
  final_price_ntd?: number
  free_days?: number
  free_months?: number
  available_at?: string
  subscription_expires_at?: string
}

function tsspePreviewFailure(err: TsspeMembershipEligibilityError): PreviewMembershipDiscountPayload {
  if (err.code === 'TSSPE_NOT_CONFIGURED') {
    return { ok: false, reason: 'invalid_code' }
  }
  if (err.code === 'TSSPE_RPC_FAILED') {
    return { ok: false, reason: 'invalid_code' }
  }
  return { ok: false, reason: 'invalid_code' }
}

/**
 * Authoritative membership discount preview（TSSPE server path；其餘委派 RPC）。
 * 不寫入 DB、不建立 entitlement。
 */
export async function previewMembershipDiscountAuthoritative(
  admin: SupabaseClient,
  userRpcClient: SupabaseClient,
  params: {
    userId: string
    codeRaw: string
    profile: {
      gender: string | null | undefined
      verification_status: string | null | undefined
      account_status: string | null | undefined
    }
    tsspeGoLiveOverrideIso?: string | null
  },
): Promise<PreviewMembershipDiscountPayload> {
  const code = normalizeMembershipDiscountCode(params.codeRaw)
  if (!code) {
    return { ok: false, reason: 'invalid_code' }
  }

  if (isTsspeMembershipDiscountCode(code)) {
    try {
      const pricing = await fetchPublicPaymentPricing(admin)
      const promoBase = pricing.membership.male.price_ntd
      const discount = await resolveTsspeMaleMembershipDiscount(admin, {
        userId: params.userId,
        profile: params.profile,
        promoBasePriceNtd: promoBase,
        goLiveOverrideIso: params.tsspeGoLiveOverrideIso,
      })
      return {
        ok: true,
        benefit: 'male_discount',
        code: discount.code,
        discount_ntd: discount.discountNtd,
        base_price_ntd: promoBase,
        final_price_ntd: discount.finalPriceNtd,
      }
    } catch (e) {
      if (e instanceof TsspeMembershipEligibilityError) {
        return tsspePreviewFailure(e)
      }
      throw e
    }
  }

  const { data, error } = await userRpcClient.rpc('preview_membership_discount_code', {
    p_code: code,
  })
  if (error) {
    return { ok: false, reason: 'invalid_code' }
  }
  return (data ?? { ok: false, reason: 'invalid_code' }) as PreviewMembershipDiscountPayload
}
