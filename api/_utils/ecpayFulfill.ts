import type { SupabaseClient } from '@supabase/supabase-js'

const FULFILL_ERROR_MESSAGES: Record<string, string> = {
  MISSING_ORDER_NO: '缺少訂單編號',
  ORDER_NOT_FOUND: '找不到訂單',
  AMOUNT_MISMATCH: '金額不符',
  ORDER_NOT_PAYABLE: '訂單狀態無法入帳',
  GRANT_MEMBERSHIP_FAILED: 'VIP 入帳失敗',
  GRANT_PACK_FAILED: '入帳失敗',
  PACK_KEY_MISSING: '道具包資料不完整',
  UNKNOWN_PRODUCT: '未知商品類型',
}

function mapFulfillRpcError(message: string): string {
  for (const [code, text] of Object.entries(FULFILL_ERROR_MESSAGES)) {
    if (message.includes(code)) return text
  }
  return message || '入帳失敗'
}

/** PaymentInfoURL／OrderResultURL 入帳；DB 端 FOR UPDATE + fulfilled_at 保證只 grant 一次。 */
export async function fulfillEcpayOrder(
  admin: SupabaseClient,
  notify: Record<string, string>,
): Promise<{ ok: true; alreadyPaid: boolean } | { ok: false; error: string }> {
  const rtnCode = notify.RtnCode?.trim()
  if (rtnCode !== '1') {
    return { ok: false, error: notify.RtnMsg || '付款未成功' }
  }

  const merchantTradeNo = notify.MerchantTradeNo?.trim()
  if (!merchantTradeNo) {
    return { ok: false, error: '缺少訂單編號' }
  }

  const tradeNo = notify.TradeNo?.trim() ?? null
  const paidAmt = Number(notify.TradeAmt)
  if (!Number.isFinite(paidAmt)) {
    return { ok: false, error: '金額不符' }
  }

  const { data, error } = await admin.rpc('fulfill_ecpay_order_for_service', {
    p_merchant_trade_no: merchantTradeNo,
    p_ecpay_trade_no: tradeNo,
    p_paid_amt: paidAmt,
    p_raw_result: notify as unknown as Record<string, unknown>,
  })

  if (error) {
    console.error('[ecpay] fulfill rpc', {
      merchantTradeNo,
      message: error.message,
      details: error.details,
      hint: error.hint,
      code: error.code,
    })
    return { ok: false, error: mapFulfillRpcError(error.message ?? '') }
  }

  const row = data as { ok?: boolean; already_fulfilled?: boolean } | null
  if (!row?.ok) {
    console.error('[ecpay] fulfill rpc bad payload', { merchantTradeNo, data })
    return { ok: false, error: '入帳失敗' }
  }

  return { ok: true, alreadyPaid: Boolean(row.already_fulfilled) }
}
