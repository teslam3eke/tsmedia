import type { SupabaseClient } from '@supabase/supabase-js'
import { parseTradeInfoPlain } from './newebpayCrypto'

export type NewebPayResultPayload = {
  MerchantOrderNo?: string
  TradeNo?: string
  Amt?: number | string
  Status?: string
  Message?: string
  RespondCode?: string
  PaymentType?: string
}

export function parseResultJson(raw: string | undefined): NewebPayResultPayload | null {
  if (!raw?.trim()) return null
  try {
    return JSON.parse(raw) as NewebPayResultPayload
  } catch {
    return null
  }
}

/** Notify／Return 解密後入帳；已 paid 則冪等跳過。 */
export async function fulfillNewebPayOrder(
  admin: SupabaseClient,
  decryptedPlain: string,
): Promise<{ ok: true; alreadyPaid: boolean } | { ok: false; error: string }> {
  const outer = parseTradeInfoPlain(decryptedPlain)
  if (outer.Status !== 'SUCCESS') {
    return { ok: false, error: outer.Message || '付款未成功' }
  }

  const result = parseResultJson(outer.Result)
  if (!result?.MerchantOrderNo) {
    return { ok: false, error: '缺少訂單編號' }
  }

  const merchantOrderNo = result.MerchantOrderNo
  const tradeNo = result.TradeNo ?? null
  const paidAmt = Number(result.Amt)

  const { data: order, error: orderErr } = await admin
    .from('newebpay_orders')
    .select('*')
    .eq('merchant_order_no', merchantOrderNo)
    .maybeSingle()

  if (orderErr || !order) {
    console.error('[newebpay] order not found', merchantOrderNo, orderErr)
    return { ok: false, error: '找不到訂單' }
  }

  if (order.status === 'paid') {
    return { ok: true, alreadyPaid: true }
  }

  if (!Number.isFinite(paidAmt) || paidAmt !== order.amount_ntd) {
    console.error('[newebpay] amount mismatch', { paidAmt, expected: order.amount_ntd, merchantOrderNo })
    return { ok: false, error: '金額不符' }
  }

  if (order.product_type === 'membership') {
    const { error: grantErr } = await admin.rpc('grant_monthly_membership_for_user', {
      p_user_id: order.user_id,
    })
    if (grantErr) {
      console.error('[newebpay] grant membership', grantErr)
      return { ok: false, error: '入帳失敗' }
    }

    const { error: logErr } = await admin.from('subscription_payment_events').insert({
      user_id: order.user_id,
      provider: 'newebpay',
      amount_ntd: order.amount_ntd,
      rec_trade_id: tradeNo,
      gateway_status: 0,
    })
    if (logErr) console.error('[newebpay] subscription log', logErr)
  } else if (order.product_type === 'credit_pack') {
    if (!order.pack_key) {
      return { ok: false, error: '道具包資料不完整' }
    }
    const { error: grantErr } = await admin.rpc('grant_credit_pack_for_user', {
      p_user_id: order.user_id,
      p_pack_key: order.pack_key,
    })
    if (grantErr) {
      console.error('[newebpay] grant pack', grantErr)
      return { ok: false, error: '入帳失敗' }
    }

    const { error: logErr } = await admin.from('credit_pack_payment_events').insert({
      user_id: order.user_id,
      pack_key: order.pack_key,
      provider: 'newebpay',
      amount_ntd: order.amount_ntd,
      rec_trade_id: tradeNo,
      gateway_status: 0,
    })
    if (logErr) console.error('[newebpay] pack log', logErr)
  } else {
    return { ok: false, error: '未知商品類型' }
  }

  const { error: updErr } = await admin
    .from('newebpay_orders')
    .update({
      status: 'paid',
      newebpay_trade_no: tradeNo,
      raw_result: result as unknown as Record<string, unknown>,
      paid_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', order.id)
    .eq('status', 'pending')

  if (updErr) {
    console.error('[newebpay] mark paid', updErr)
    return { ok: false, error: '更新訂單失敗' }
  }

  return { ok: true, alreadyPaid: false }
}
