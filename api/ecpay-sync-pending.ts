/**
 * POST — 同步本人最近一筆 pending 綠界訂單（重啟 PWA 後無 payment=return 時補入帳）
 */
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { readAuthedUserId } from './_utils/tappayPayByPrime.js'
import { readEcpayConfig } from './_utils/ecpayConfig.js'
import { fulfillEcpayOrder } from './_utils/ecpayFulfill.js'
import { isEcpayTradePaid, queryEcpayTrade } from './_utils/ecpayQueryTrade.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Authorization')
  res.setHeader('Cache-Control', 'no-store')

  if (req.method === 'OPTIONS') {
    return res.status(204).end()
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' })
  }

  const cfgRes = readEcpayConfig(true)
  if (!cfgRes.ok) {
    return res.status(500).json({ ok: false, error: cfgRes.error })
  }
  const { cfg } = cfgRes

  const auth = await readAuthedUserId(req, cfg.supabaseUrl, cfg.supabaseAnonKey)
  if (!auth.ok) {
    return res.status(auth.status).json({ ok: false, error: auth.error })
  }

  const admin = createClient(cfg.supabaseUrl, cfg.supabaseServiceKey)

  const since = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString()
  const { data: pendingOrders, error: listErr } = await admin
    .from('ecpay_orders')
    .select('merchant_trade_no, amount_ntd, product_type, pack_key, status, created_at')
    .eq('user_id', auth.userId)
    .eq('status', 'pending')
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(3)

  if (listErr) {
    console.error('[ecpay-sync-pending] list', listErr)
    return res.status(500).json({ ok: false, error: '無法讀取訂單' })
  }

  if (!pendingOrders?.length) {
    return res.status(200).json({ ok: true, synced: false, reason: 'no_pending' })
  }

  for (const order of pendingOrders) {
    const orderNo = order.merchant_trade_no
    const queried = await queryEcpayTrade(cfg, orderNo)
    if (!queried.ok) {
      console.warn('[ecpay-sync-pending] query', orderNo, queried.error)
      continue
    }
    if (!isEcpayTradePaid(queried.body)) {
      continue
    }

    const fulfill = await fulfillEcpayOrder(admin, {
      RtnCode: '1',
      MerchantTradeNo: queried.body.MerchantTradeNo ?? orderNo,
      TradeNo: queried.body.TradeNo ?? '',
      TradeAmt: queried.body.TradeAmt ?? String(order.amount_ntd),
      ...queried.body,
    })

    if (!fulfill.ok) {
      console.error('[ecpay-sync-pending] fulfill', orderNo, fulfill.error)
      return res.status(200).json({
        ok: true,
        synced: false,
        orderNo,
        error: fulfill.error,
      })
    }

    let subscriptionExpiresAt: string | null = null
    if (order.product_type === 'membership') {
      const { data: profile } = await admin
        .from('profiles')
        .select('subscription_expires_at')
        .eq('id', auth.userId)
        .maybeSingle()
      subscriptionExpiresAt = profile?.subscription_expires_at ?? null
    }

    return res.status(200).json({
      ok: true,
      synced: true,
      orderNo,
      productType: order.product_type,
      packKey: order.pack_key,
      subscriptionExpiresAt,
    })
  }

  return res.status(200).json({ ok: true, synced: false, reason: 'gateway_unpaid' })
}
