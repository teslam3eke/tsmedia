/**
 * Vercel Serverless: TapPay pay-by-prime → grant credit pack (service_role RPC).
 */
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import {
  readAuthedUserId,
  readTapPayServerConfig,
  tappayPayByPrime,
  type TapPayCardholder,
} from './_utils/tappayPayByPrime'

const PACKS: Record<string, { amount: number; details: string }> = {
  super_like_5: { amount: 199, details: 'tsMedia 加購：超級喜歡 x5' },
  blur_unlock_16: { amount: 99, details: 'tsMedia 加購：解除拼圖 x16' },
}

type Body = {
  packKey?: string
  prime?: string
  cardholder?: TapPayCardholder
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')

  if (req.method === 'OPTIONS') {
    return res.status(204).end()
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' })
  }

  const cfg = readTapPayServerConfig()
  if (!cfg.ok) {
    console.error('[tappay-credit-pack] Missing server env')
    return res.status(500).json({ ok: false, error: cfg.error })
  }

  const auth = await readAuthedUserId(req, cfg.url, cfg.anon)
  if (!auth.ok) {
    return res.status(auth.status).json({ ok: false, error: auth.error })
  }

  const body = (typeof req.body === 'string' ? JSON.parse(req.body) : req.body) as Body
  const packKey = body.packKey?.trim() ?? ''
  const pack = PACKS[packKey]
  if (!pack) {
    return res.status(400).json({ ok: false, error: '無效的商品。' })
  }

  const prime = body.prime?.trim()
  const ch = body.cardholder
  if (!prime || !ch?.phone_number?.trim() || !ch?.name?.trim() || !ch?.email?.trim()) {
    return res.status(400).json({ ok: false, error: '請填寫持卡人姓名、電話與 Email。' })
  }

  const pay = await tappayPayByPrime({
    prime,
    cardholder: ch,
    amount: pack.amount,
    details: pack.details,
    sandbox: cfg.sandbox,
    partnerKey: cfg.partnerKey,
    merchantId: cfg.merchantId,
  })

  if (!pay.ok) {
    console.warn('[tappay-credit-pack] TapPay declined', packKey, pay.error)
    return res.status(400).json({ ok: false, error: pay.error })
  }

  const admin = createClient(cfg.url, cfg.serviceKey)
  const { data: grantData, error: grantErr } = await admin.rpc('grant_credit_pack_for_user', {
    p_user_id: auth.userId,
    p_pack_key: packKey,
  })

  if (grantErr) {
    console.error('[tappay-credit-pack] grant RPC after charge', grantErr)
    return res.status(500).json({
      ok: false,
      error: '已授權但入帳失敗，請聯絡客服並提供交易序號。',
    })
  }

  const { error: insErr } = await admin.from('credit_pack_payment_events').insert({
    user_id: auth.userId,
    pack_key: packKey,
    provider: 'tappay',
    amount_ntd: pack.amount,
    rec_trade_id: pay.recTradeId ?? null,
    gateway_status: pay.gatewayStatus,
  })
  if (insErr) {
    console.error('[tappay-credit-pack] log insert', insErr)
  }

  return res.status(200).json({ ok: true, packKey, grant: grantData })
}
