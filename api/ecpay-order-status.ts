/**
 * GET ?order=TS... — 付款返回後輪詢訂單狀態（須登入且為本人訂單）
 */
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { readAuthedUserId } from './_utils/tappayPayByPrime.js'
import { readEcpayConfig } from './_utils/ecpayConfig.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Authorization')
  res.setHeader('Cache-Control', 'no-store')

  if (req.method === 'OPTIONS') {
    return res.status(204).end()
  }

  if (req.method !== 'GET') {
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

  const orderNo =
    typeof req.query.order === 'string'
      ? req.query.order.trim()
      : Array.isArray(req.query.order)
        ? req.query.order[0]?.trim()
        : ''

  if (!orderNo) {
    return res.status(400).json({ ok: false, error: '缺少訂單編號' })
  }

  const admin = createClient(cfg.supabaseUrl, cfg.supabaseServiceKey)
  const { data: order, error } = await admin
    .from('ecpay_orders')
    .select('merchant_trade_no, user_id, product_type, pack_key, amount_ntd, status, paid_at')
    .eq('merchant_trade_no', orderNo)
    .maybeSingle()

  if (error || !order) {
    return res.status(404).json({ ok: false, error: '找不到訂單' })
  }

  if (order.user_id !== auth.userId) {
    return res.status(403).json({ ok: false, error: '無權查看此訂單' })
  }

  let subscriptionExpiresAt: string | null = null
  if (order.status === 'paid' && order.product_type === 'membership') {
    const { data: profile } = await admin
      .from('profiles')
      .select('subscription_expires_at')
      .eq('id', auth.userId)
      .maybeSingle()
    subscriptionExpiresAt = profile?.subscription_expires_at ?? null
  }

  return res.status(200).json({
    ok: true,
    status: order.status,
    paid: order.status === 'paid',
    productType: order.product_type,
    packKey: order.pack_key,
    amountNtd: order.amount_ntd,
    paidAt: order.paid_at,
    subscriptionExpiresAt,
  })
}
