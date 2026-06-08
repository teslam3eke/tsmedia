import type { SupabaseClient } from '@supabase/supabase-js'

/** PaymentInfoURL 背景通知入帳；已 paid 則冪等跳過。 */
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

  const { data: order, error: orderErr } = await admin
    .from('ecpay_orders')
    .select('*')
    .eq('merchant_trade_no', merchantTradeNo)
    .maybeSingle()

  if (orderErr || !order) {
    console.error('[ecpay] order not found', merchantTradeNo, orderErr)
    return { ok: false, error: '找不到訂單' }
  }

  if (order.status === 'paid') {
    return { ok: true, alreadyPaid: true }
  }

  if (!Number.isFinite(paidAmt) || paidAmt !== order.amount_ntd) {
    console.error('[ecpay] amount mismatch', { paidAmt, expected: order.amount_ntd, merchantTradeNo })
    return { ok: false, error: '金額不符' }
  }

  if (order.product_type === 'membership') {
    const { error: grantErr } = await admin.rpc('grant_monthly_membership_for_user', {
      p_user_id: order.user_id,
    })
    if (grantErr) {
      console.error('[ecpay] grant membership', grantErr)
      return { ok: false, error: '入帳失敗' }
    }

    const { error: logErr } = await admin.from('subscription_payment_events').insert({
      user_id: order.user_id,
      provider: 'ecpay',
      amount_ntd: order.amount_ntd,
      rec_trade_id: tradeNo,
      gateway_status: 0,
    })
    if (logErr) console.error('[ecpay] subscription log', logErr)
  } else if (order.product_type === 'credit_pack') {
    if (!order.pack_key) {
      return { ok: false, error: '道具包資料不完整' }
    }
    const { error: grantErr } = await admin.rpc('grant_credit_pack_for_user', {
      p_user_id: order.user_id,
      p_pack_key: order.pack_key,
    })
    if (grantErr) {
      console.error('[ecpay] grant pack', grantErr)
      return { ok: false, error: '入帳失敗' }
    }

    const { error: logErr } = await admin.from('credit_pack_payment_events').insert({
      user_id: order.user_id,
      pack_key: order.pack_key,
      provider: 'ecpay',
      amount_ntd: order.amount_ntd,
      rec_trade_id: tradeNo,
      gateway_status: 0,
    })
    if (logErr) console.error('[ecpay] pack log', logErr)
  } else {
    return { ok: false, error: '未知商品類型' }
  }

  const { error: updErr } = await admin
    .from('ecpay_orders')
    .update({
      status: 'paid',
      ecpay_trade_no: tradeNo,
      raw_result: notify as unknown as Record<string, unknown>,
      paid_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', order.id)
    .eq('status', 'pending')

  if (updErr) {
    console.error('[ecpay] mark paid', updErr)
    return { ok: false, error: '更新訂單失敗' }
  }

  return { ok: true, alreadyPaid: false }
}
