import type { SupabaseClient } from '@supabase/supabase-js'
import type { UserCouponDefinition } from './membershipCheckoutPricing.js'
import { assertAcquisitionCouponApplicableToCheckout } from './userCouponProductEligibility.js'

export type LoadedUserCouponEntitlement = UserCouponDefinition & {
  entitlementId: string
}

type EntitlementRow = {
  id: string
  user_id: string
  campaign_key: string
  status: string
  expires_at: string | null
  coupon_campaign_definitions: {
    discount_kind: 'fixed_amount' | 'pay_ratio_tenths'
    discount_value: number
    stacking_policy: 'stack_on_promo_price' | 'replace_promo_use_list_price'
    allows_membership_discount_code: boolean
    enabled: boolean
    eligible_product_key: string
  } | null
}

function mapRow(row: EntitlementRow): LoadedUserCouponEntitlement {
  const def = row.coupon_campaign_definitions
  if (!def?.enabled) {
    throw new Error('COUPON_CAMPAIGN_DISABLED')
  }
  return {
    entitlementId: row.id,
    campaignKey: row.campaign_key as LoadedUserCouponEntitlement['campaignKey'],
    discountKind: def.discount_kind,
    discountValue: def.discount_value,
    stackingPolicy: def.stacking_policy,
    allowsMembershipDiscountCode: def.allows_membership_discount_code,
    eligibleProductKey: def.eligible_product_key,
  }
}

export function normalizeUserCouponEntitlementId(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  return trimmed.length > 0 ? trimmed : null
}

export async function loadUserCouponEntitlementForCheckout(
  admin: SupabaseClient,
  userId: string,
  entitlementId: string,
  checkoutContext?: {
    checkoutProductType: 'membership' | 'credit_pack'
    gender: 'male' | 'female' | null | undefined
  },
): Promise<LoadedUserCouponEntitlement> {
  const { data, error } = await admin
    .from('user_coupon_entitlements')
    .select(
      `
      id,
      user_id,
      campaign_key,
      status,
      expires_at,
      coupon_campaign_definitions (
        discount_kind,
        discount_value,
        stacking_policy,
        allows_membership_discount_code,
        enabled,
        eligible_product_key
      )
    `,
    )
    .eq('id', entitlementId)
    .maybeSingle()

  if (error) throw new Error(error.message)
  if (!data) throw new Error('COUPON_ENTITLEMENT_NOT_FOUND')
  if (data.user_id !== userId) throw new Error('COUPON_ENTITLEMENT_USER_MISMATCH')

  const status = data.status as string
  if (status === 'redeemed') throw new Error('COUPON_ALREADY_REDEEMED')
  if (status === 'cancelled') throw new Error('COUPON_CANCELLED')
  if (status !== 'available' && status !== 'reserved') {
    throw new Error('COUPON_NOT_AVAILABLE')
  }
  if (data.expires_at != null && new Date(data.expires_at).getTime() <= Date.now()) {
    throw new Error('COUPON_EXPIRED')
  }

  const mapped = mapRow(data as EntitlementRow)
  if (checkoutContext) {
    assertAcquisitionCouponApplicableToCheckout({
      eligibleProductKey: mapped.eligibleProductKey,
      checkoutProductType: checkoutContext.checkoutProductType,
      gender: checkoutContext.gender,
    })
  }
  return mapped
}

export async function reserveUserCouponForEcpayOrder(
  admin: SupabaseClient,
  params: {
    entitlementId: string
    userId: string
    merchantTradeNo: string
  },
): Promise<void> {
  const { data, error } = await admin.rpc('reserve_user_coupon_for_ecpay_order', {
    p_entitlement_id: params.entitlementId,
    p_user_id: params.userId,
    p_merchant_trade_no: params.merchantTradeNo,
    p_product_type: 'membership',
  })

  if (error) {
    const msg = error.message ?? ''
    const match = msg.match(/COUPON_[A-Z_]+|COUPON_NOT_[A-Z_]+/)
    throw new Error(match?.[0] ?? msg)
  }
  if (!data || typeof data !== 'object' || (data as { ok?: boolean }).ok !== true) {
    throw new Error('COUPON_RESERVE_FAILED')
  }
}

export async function releaseUserCouponReservationForEcpay(
  admin: SupabaseClient,
  merchantTradeNo: string,
): Promise<void> {
  const { error } = await admin.rpc('release_user_coupon_reservation_for_ecpay', {
    p_merchant_trade_no: merchantTradeNo,
  })
  if (error) {
    console.warn('[coupon] release reservation', merchantTradeNo, error.message)
  }
}

export function userCouponErrorToClientMessage(code: string): string {
  switch (code) {
    case 'COUPON_ENTITLEMENT_NOT_FOUND':
      return '找不到此優惠券，請確認連結或重新整理。'
    case 'COUPON_ENTITLEMENT_USER_MISMATCH':
      return '此優惠券不屬於目前帳號。'
    case 'COUPON_ALREADY_REDEEMED':
      return '此優惠券已使用過。'
    case 'COUPON_EXPIRED':
      return '此優惠券已過期。'
    case 'COUPON_NOT_AVAILABLE':
    case 'COUPON_CANCELLED':
      return '此優惠券目前無法使用。'
    case 'COUPON_ALREADY_RESERVED':
      return '此優惠券正在另一筆付款中使用，請稍後再試。'
    case 'COUPON_MALE_ONLY':
      return '此優惠券僅限男性會員 VIP 購買。'
    case 'COUPON_NOT_FIRST_MEMBERSHIP_PURCHASE':
      return '此優惠券僅限首次付費開通 VIP。'
    case 'COUPON_CAMPAIGN_DISABLED':
      return '此優惠方案已停止。'
    case 'COUPON_NOT_APPLICABLE_TO_PRODUCT':
      return '此優惠券僅限男性 VIP 月卡結帳，無法用於其他商品。'
    default:
      return '無法套用優惠券，請稍後再試。'
  }
}
