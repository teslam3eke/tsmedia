/** 一般全站 payment_promo_campaigns：最低 5 折（使用者至少付 list × 50%） */
export const MIN_GENERAL_PROMO_DISCOUNT_TENTHS = 5

export class GeneralPromoDiscountError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GeneralPromoDiscountError'
  }
}

export function validateGeneralPromoDiscountTenths(discountTenths: number): void {
  if (!Number.isInteger(discountTenths) || discountTenths < MIN_GENERAL_PROMO_DISCOUNT_TENTHS) {
    throw new GeneralPromoDiscountError('GENERAL_PROMO_DISCOUNT_TOO_LOW')
  }
  if (discountTenths > 10) {
    throw new GeneralPromoDiscountError('GENERAL_PROMO_DISCOUNT_TOO_HIGH')
  }
}

/** 與 DB `_payment_effective_price_ntd` 對齊（tenths 會 clamp 至 ≥5） */
export function generalPromoPriceFromListNtd(listPriceNtd: number, discountTenths: number): number {
  const effectiveTenths = Math.max(MIN_GENERAL_PROMO_DISCOUNT_TENTHS, discountTenths)
  return Math.max(1, Math.floor((listPriceNtd * effectiveTenths) / 10))
}

/** 與 DB `_payment_promo_campaign_may_still_apply` 對齊 */
export type PromoCampaignRowLike = {
  discount_tenths: number
  cancelled_at: string | null
  ends_at: string
}

export function paymentPromoCampaignMayStillApply(
  row: PromoCampaignRowLike,
  nowMs = Date.now(),
): boolean {
  if (row.cancelled_at) return false
  return new Date(row.ends_at).getTime() > nowMs
}

/** migration 162：僅 bump 仍可能生效且 tenths < 5 的列 */
export function shouldBumpLowDiscountCampaignToFive(
  row: PromoCampaignRowLike,
  nowMs = Date.now(),
): boolean {
  return row.discount_tenths < MIN_GENERAL_PROMO_DISCOUNT_TENTHS
    && paymentPromoCampaignMayStillApply(row, nowMs)
}

/** 與 DB conditional CHECK 對齊 */
export function satisfiesHistoricalPromoDiscountCheck(
  row: PromoCampaignRowLike,
  nowMs = Date.now(),
): boolean {
  if (row.discount_tenths < 1 || row.discount_tenths > 10) return false
  if (row.discount_tenths >= MIN_GENERAL_PROMO_DISCOUNT_TENTHS) return true
  if (row.cancelled_at) return true
  return new Date(row.ends_at).getTime() <= nowMs
}
