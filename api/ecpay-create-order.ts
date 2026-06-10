/**
 * POST：建立綠界 AIO 訂單 → 回傳表單欄位（前端 POST 至付款頁）
 * Body: { productType: 'membership' | 'credit_pack', packKey?, email? }
 */
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { readAuthedUserId } from './_utils/tappayPayByPrime.js'
import { buildCheckMacValue } from './_utils/ecpayCrypto.js'
import { readEcpayConfig } from './_utils/ecpayConfig.js'
import {
  CREDIT_PACKS,
  formatEcpayMerchantTradeDate,
  makeMerchantTradeNo,
  membershipAmountNtd,
} from './_utils/paymentProducts.js'

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

  const cfgRes = readEcpayConfig(true)
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
  let itemName: string
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

    amount = membershipAmountNtd(profile.gender as 'male' | 'female')
    itemDesc = 'tsMedia VIP 月卡 30 天'
    itemName = 'tsMedia VIP 月卡 30 天'
  } else if (productType === 'credit_pack') {
    const pack = CREDIT_PACKS[packKey]
    if (!pack) {
      return res.status(400).json({ ok: false, error: '無效的道具包。' })
    }

    if (packKey === 'crown_effect') {
      const { data: crownProfile, error: crownErr } = await admin
        .from('profiles')
        .select('gender, crown_effect_purchased_at')
        .eq('id', auth.userId)
        .maybeSingle()

      if (crownErr || crownProfile?.gender !== 'male') {
        return res.status(400).json({ ok: false, error: '皇冠特效僅限男性會員購買。' })
      }
      if (crownProfile?.crown_effect_purchased_at) {
        return res.status(400).json({ ok: false, error: '您已購買過皇冠特效。' })
      }
    }

    amount = pack.amount
    itemDesc = pack.details
    itemName = pack.itemName
    packKeyToStore = packKey
  } else {
    return res.status(400).json({ ok: false, error: '請指定商品類型。' })
  }

  const merchantTradeNo = makeMerchantTradeNo()

  const { error: insErr } = await admin.from('ecpay_orders').insert({
    merchant_trade_no: merchantTradeNo,
    user_id: auth.userId,
    product_type: productType,
    pack_key: packKeyToStore,
    amount_ntd: amount,
    item_desc: itemDesc,
    status: 'pending',
  })

  if (insErr) {
    console.error('[ecpay-create-order] insert', insErr)
    return res.status(500).json({ ok: false, error: '無法建立訂單，請稍後再試。' })
  }

  const formFields: Record<string, string> = {
    MerchantID: cfg.merchantId,
    MerchantTradeNo: merchantTradeNo,
    MerchantTradeDate: formatEcpayMerchantTradeDate(),
    PaymentType: 'aio',
    TotalAmount: String(amount),
    TradeDesc: itemDesc.slice(0, 200),
    ItemName: itemName.slice(0, 400),
    ReturnURL: cfg.notifyUrl,
    OrderResultURL: cfg.returnUrl,
    ClientBackURL: cfg.clientBackUrl,
    ChoosePayment: 'Credit',
    EncryptType: '1',
    ...(email ? { CustomerEmail: email.slice(0, 200) } : {}),
  }

  formFields.CheckMacValue = buildCheckMacValue(formFields, cfg.hashKey, cfg.hashIV)

  return res.status(200).json({
    ok: true,
    merchantTradeNo,
    gatewayUrl: cfg.gatewayUrl,
    formFields,
    amountNtd: amount,
    sandbox: cfg.sandbox,
  })
}
