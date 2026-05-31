/**
 * POST：建立藍新 MPG 訂單 → 回傳表單欄位（前端 POST 至付款頁）
 * Body: { productType: 'membership' | 'credit_pack', packKey?, email? }
 */
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { readAuthedUserId } from './_utils/tappayPayByPrime'
import {
  buildMpgTradeQuery,
  buildTradeSha,
  encryptTradeInfo,
} from './_utils/newebpayCrypto'
import { makeMerchantOrderNo, readNewebPayConfig } from './_utils/newebpayConfig'

const PACKS: Record<string, { amount: number; details: string }> = {
  super_like_5: { amount: 199, details: 'tsMedia 加購：超級喜歡 x5' },
  blur_unlock_16: { amount: 99, details: 'tsMedia 加購：解除拼圖 x16' },
}

type Body = {
  productType?: 'membership' | 'credit_pack'
  packKey?: string
  email?: string
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

  const cfgRes = readNewebPayConfig(true)
  if (!cfgRes.ok) {
    return res.status(500).json({ ok: false, error: cfgRes.error })
  }
  const { cfg } = cfgRes

  const auth = await readAuthedUserId(req, cfg.supabaseUrl, cfg.supabaseAnonKey)
  if (!auth.ok) {
    return res.status(auth.status).json({ ok: false, error: auth.error })
  }

  const body = (typeof req.body === 'string' ? JSON.parse(req.body) : req.body) as Body
  const productType = body.productType
  const packKey = body.packKey?.trim() ?? ''
  const email = body.email?.trim() || undefined

  const admin = createClient(cfg.supabaseUrl, cfg.supabaseServiceKey)

  let amount: number
  let itemDesc: string
  let packKeyToStore: string | null = null

  if (productType === 'membership') {
    const { data: profile, error: profileErr } = await admin
      .from('profiles')
      .select('gender')
      .eq('id', auth.userId)
      .maybeSingle()

    if (profileErr || !profile?.gender) {
      return res.status(400).json({ ok: false, error: '請先完成個人資料性別設定。' })
    }

    amount = profile.gender === 'male' ? 399 : 299
    itemDesc = `tsMedia VIP 月卡 30 天`
  } else if (productType === 'credit_pack') {
    const pack = PACKS[packKey]
    if (!pack) {
      return res.status(400).json({ ok: false, error: '無效的道具包。' })
    }
    amount = pack.amount
    itemDesc = pack.details
    packKeyToStore = packKey
  } else {
    return res.status(400).json({ ok: false, error: '請指定商品類型。' })
  }

  const merchantOrderNo = makeMerchantOrderNo()

  const { error: insErr } = await admin.from('newebpay_orders').insert({
    merchant_order_no: merchantOrderNo,
    user_id: auth.userId,
    product_type: productType,
    pack_key: packKeyToStore,
    amount_ntd: amount,
    item_desc: itemDesc,
    status: 'pending',
  })

  if (insErr) {
    console.error('[newebpay-create-order] insert', insErr)
    return res.status(500).json({ ok: false, error: '無法建立訂單，請稍後再試。' })
  }

  const tradePlain = buildMpgTradeQuery({
    MerchantID: cfg.merchantId,
    RespondType: 'JSON',
    TimeStamp: Math.floor(Date.now() / 1000),
    Version: '2.0',
    MerchantOrderNo: merchantOrderNo,
    Amt: amount,
    ItemDesc: itemDesc,
    ...(email ? { Email: email } : {}),
    NotifyURL: cfg.notifyUrl,
    ReturnURL: cfg.returnUrl,
    ClientBackURL: `${cfg.siteUrl}/?payment=cancel`,
    LoginType: 0,
    CREDIT: 1,
  })

  const tradeInfo = encryptTradeInfo(tradePlain, cfg.hashKey, cfg.hashIV)
  const tradeSha = buildTradeSha(tradeInfo, cfg.hashKey, cfg.hashIV)

  return res.status(200).json({
    ok: true,
    merchantOrderNo,
    gatewayUrl: cfg.gatewayUrl,
    merchantId: cfg.merchantId,
    tradeInfo,
    tradeSha,
    version: '2.0',
    amountNtd: amount,
    sandbox: cfg.sandbox,
  })
}
