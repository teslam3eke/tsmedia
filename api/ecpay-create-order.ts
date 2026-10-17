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
} from './_utils/paymentProducts.js'
import {
  fetchPublicPaymentPricing,
  membershipAmountFromPricing,
  packAmountFromPricing,
} from './_utils/pricingResolver.js'
import { resolveMaleMembershipCheckout } from './_utils/resolveMaleMembershipCheckout.js'
import {
  MembershipCheckoutPricingError,
  stripUntrustedCheckoutPriceFields,
} from './_utils/membershipCheckoutPricing.js'
import {
  normalizeUserCouponEntitlementId,
  reserveUserCouponForEcpayOrder,
  userCouponErrorToClientMessage,
} from './_utils/userCouponEntitlement.js'
import {
  readClientIpFromRequest,
  readClientUserAgent,
  readEventSourceUrlFromBody,
  readMetaAttributionFromBody,
} from './_utils/clientRequestMeta.js'

type Body = {
  productType?: 'membership' | 'credit_pack'
  packKey?: string
  email?: string
  membershipDiscountCode?: string
  userCouponEntitlementId?: string
  metaFbp?: string
  metaFbc?: string
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

  const bodyRaw = (typeof req.body === 'string' ? JSON.parse(req.body) : req.body) as Body &
    Record<string, unknown>
  stripUntrustedCheckoutPriceFields(bodyRaw)
  const body = bodyRaw
  const productType = body.productType
  const packKey = body.packKey?.trim() ?? ''
  const email = body.email?.trim() || undefined
  const userCouponEntitlementIdEarly = normalizeUserCouponEntitlementId(
    body.userCouponEntitlementId,
  )

  if (userCouponEntitlementIdEarly && productType !== 'membership') {
    return res.status(400).json({
      ok: false,
      error: '此優惠券僅限男性 VIP 月卡結帳，無法用於其他商品。',
    })
  }

  const admin = createClient(cfg.supabaseUrl, cfg.supabaseServiceKey)

  let pricing
  try {
    pricing = await fetchPublicPaymentPricing(admin)
  } catch (e) {
    console.error('[ecpay-create-order] pricing', e)
    return res.status(500).json({ ok: false, error: '無法取得商品價格，請稍後再試。' })
  }

  let amount: number
  let itemDesc: string
  let itemName: string
  let packKeyToStore: string | null = null
  let membershipDiscountCodeToStore: string | null = null
  let userCouponEntitlementIdToStore: string | null = null

  if (productType === 'membership') {
    const { data: profile, error: profileErr } = await admin
      .from('profiles')
      .select('gender, verification_status, account_status')
      .eq('id', auth.userId)
      .maybeSingle()

    if (profileErr || !profile?.gender) {
      return res.status(400).json({ ok: false, error: '請先完成個人資料性別設定。' })
    }

    const userCouponEntitlementId = normalizeUserCouponEntitlementId(body.userCouponEntitlementId)

    if (profile.gender === 'female') {
      if (userCouponEntitlementId) {
        return res.status(400).json({ ok: false, error: '此優惠券僅限男性會員 VIP 購買。' })
      }
      amount = membershipAmountFromPricing(pricing, 'female')
    } else {
      const needsDiscountEligibility =
        Boolean(body.membershipDiscountCode?.trim()) || Boolean(userCouponEntitlementId)
      if (needsDiscountEligibility) {
        if (profile.verification_status !== 'approved' || profile.account_status !== 'active') {
          return res.status(400).json({ ok: false, error: '目前帳號不符合折扣碼使用資格。' })
        }
      }
      try {
        const resolved = await resolveMaleMembershipCheckout(admin, {
          userId: auth.userId,
          pricing,
          membershipDiscountCodeRaw: body.membershipDiscountCode,
          userCouponEntitlementIdRaw: userCouponEntitlementId,
        })
        amount = resolved.amountNtd
        membershipDiscountCodeToStore = resolved.membershipDiscountCode
        userCouponEntitlementIdToStore = resolved.userCouponEntitlementId
      } catch (e) {
        if (e instanceof MembershipCheckoutPricingError) {
          if (e.code === 'COUPON_STACKING_CONFLICT') {
            return res.status(400).json({
              ok: false,
              error: '此優惠券不可與目前的折扣碼或活動價同時使用。',
            })
          }
          return res.status(400).json({ ok: false, error: '無法套用優惠券。' })
        }
        if (e instanceof Error && e.message === 'INVALID_MEMBERSHIP_DISCOUNT_CODE') {
          return res.status(400).json({ ok: false, error: '折扣碼無效或已停止使用。' })
        }
        if (e instanceof Error && e.message.startsWith('COUPON_')) {
          return res.status(400).json({
            ok: false,
            error: userCouponErrorToClientMessage(e.message),
          })
        }
        console.error('[ecpay-create-order] membership checkout pricing', e)
        return res.status(500).json({ ok: false, error: '暫時無法計算付款金額，請稍後再試。' })
      }
    }
    itemDesc = 'tsMedia VIP 月卡 30 天'
    itemName = 'tsMedia VIP 月卡 30 天'
  } else if (productType === 'credit_pack') {
    if (userCouponEntitlementIdEarly) {
      return res.status(400).json({
        ok: false,
        error: '此優惠券僅限男性 VIP 月卡結帳，無法用於其他商品。',
      })
    }
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

    const resolvedAmount = packAmountFromPricing(pricing, packKey)
    if (resolvedAmount == null) {
      return res.status(400).json({ ok: false, error: '無效的道具包。' })
    }
    amount = resolvedAmount
    itemDesc = pack.details
    itemName = pack.itemName
    packKeyToStore = packKey
  } else {
    return res.status(400).json({ ok: false, error: '請指定商品類型。' })
  }

  const merchantTradeNo = makeMerchantTradeNo()
  const { metaFbp, metaFbc } = readMetaAttributionFromBody(body)
  const metaEventSourceUrl = readEventSourceUrlFromBody(body)
  const clientIp = readClientIpFromRequest(req)
  const clientUserAgent = readClientUserAgent(req)

  const { error: insErr } = await admin.from('ecpay_orders').insert({
    merchant_trade_no: merchantTradeNo,
    user_id: auth.userId,
    product_type: productType,
    pack_key: packKeyToStore,
    amount_ntd: amount,
    item_desc: itemDesc,
    status: 'pending',
    membership_discount_code: membershipDiscountCodeToStore,
    user_coupon_entitlement_id: userCouponEntitlementIdToStore,
    meta_fbp: metaFbp,
    meta_fbc: metaFbc,
    meta_event_source_url: metaEventSourceUrl,
    client_ip: clientIp,
    client_user_agent: clientUserAgent,
  })

  if (insErr) {
    console.error('[ecpay-create-order] insert', insErr)
    return res.status(500).json({ ok: false, error: '無法建立訂單，請稍後再試。' })
  }

  if (userCouponEntitlementIdToStore) {
    try {
      await reserveUserCouponForEcpayOrder(admin, {
        entitlementId: userCouponEntitlementIdToStore,
        userId: auth.userId,
        merchantTradeNo,
      })
    } catch (e) {
      await admin.from('ecpay_orders').delete().eq('merchant_trade_no', merchantTradeNo)
      const code = e instanceof Error ? e.message : ''
      if (code.startsWith('COUPON_')) {
        return res.status(400).json({
          ok: false,
          error: userCouponErrorToClientMessage(code),
        })
      }
      console.error('[ecpay-create-order] coupon reserve', e)
      return res.status(500).json({ ok: false, error: '無法保留優惠券，請稍後再試。' })
    }
  }

  if (metaFbp || metaFbc) {
    const profilePatch: Record<string, string> = {
      meta_attribution_updated_at: new Date().toISOString(),
    }
    if (metaFbp) profilePatch.meta_fbp = metaFbp
    if (metaFbc) profilePatch.meta_fbc = metaFbc
    const { error: attrErr } = await admin.from('profiles').update(profilePatch).eq('id', auth.userId)
    if (attrErr) {
      console.warn('[ecpay-create-order] meta attribution profile update', attrErr.message)
    }
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
