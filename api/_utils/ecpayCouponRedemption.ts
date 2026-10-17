/** 與 migration 162 `release_stale_user_coupon_reservations` 對齊 */
export type EcpayOrderForStaleRelease = {
  status: string
  fulfilled_at: string | null
  paid_at: string | null
  created_at: string
}

export function canReleaseStaleCouponReservation(
  order: EcpayOrderForStaleRelease,
  pendingMaxAgeMs: number,
  nowMs = Date.now(),
): boolean {
  if (order.status !== 'pending') return false
  if (order.fulfilled_at) return false
  if (order.paid_at) return false
  return nowMs - new Date(order.created_at).getTime() > pendingMaxAgeMs
}

export type FulfillCouponInvariant = {
  grantSucceeded: boolean
  fulfilledAtSet: boolean
  couponRedemptionStatus: string | null
}

/** 付款後：會員開通不可被 coupon bookkeeping 阻擋 */
export function membershipGrantedDespiteCouponBookkeepingFailure(
  state: FulfillCouponInvariant,
): boolean {
  return state.grantSucceeded
    && state.fulfilledAtSet
    && state.couponRedemptionStatus === 'reconciliation_required'
}
