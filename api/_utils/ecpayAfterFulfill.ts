import type { SupabaseClient } from '@supabase/supabase-js'
import { deliverMetaPurchaseCapiIfNeeded } from './ecpayMetaCapiPurchase.js'

/**
 * fulfill 成功後：await Meta CAPI（失敗不影響綠界回應／入帳）。
 */
export async function afterEcpayFulfillSuccess(
  admin: SupabaseClient,
  merchantTradeNo: string,
): Promise<void> {
  try {
    await deliverMetaPurchaseCapiIfNeeded(admin, merchantTradeNo.trim())
  } catch (e) {
    console.warn('[ecpay] meta capi after fulfill', {
      merchantTradeNo,
      message: e instanceof Error ? e.message : 'unknown',
    })
  }
}
