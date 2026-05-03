/**
 * Vercel Serverless: TapPay pay-by-prime → extend monthly membership (service_role RPC).
 * Env: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY,
 *      TAPPAY_PARTNER_KEY, TAPPAY_MERCHANT_ID, TAPPAY_SANDBOX=true|false
 */
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

type Cardholder = {
  phone_number: string
  name: string
  email: string
  zip_code?: string
  address?: string
  national_id?: string
}

type TapPayPrimeBody = {
  prime?: string
  cardholder?: Cardholder
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

  const url = process.env.SUPABASE_URL
  const anon = process.env.SUPABASE_ANON_KEY
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const partnerKey = process.env.TAPPAY_PARTNER_KEY
  const merchantId = process.env.TAPPAY_MERCHANT_ID
  const sandbox = process.env.TAPPAY_SANDBOX !== 'false'

  if (!url || !anon || !serviceKey || !partnerKey || !merchantId) {
    console.error('[tappay-membership] Missing server env')
    return res.status(500).json({ ok: false, error: '伺服器未設定金流（環境變數）。' })
  }

  const authHeader = req.headers.authorization
  const token =
    typeof authHeader === 'string' && authHeader.startsWith('Bearer ')
      ? authHeader.slice(7)
      : null

  if (!token) {
    return res.status(401).json({ ok: false, error: '請重新登入後再試。' })
  }

  const userClient = createClient(url, anon)
  const {
    data: { user },
    error: userErr,
  } = await userClient.auth.getUser(token)

  if (userErr || !user) {
    return res.status(401).json({ ok: false, error: '登入已過期，請重新登入。' })
  }

  const body = (typeof req.body === 'string' ? JSON.parse(req.body) : req.body) as TapPayPrimeBody
  const prime = body.prime?.trim()
  const ch = body.cardholder

  if (!prime || !ch?.phone_number?.trim() || !ch?.name?.trim() || !ch?.email?.trim()) {
    return res.status(400).json({ ok: false, error: '請填寫持卡人姓名、電話與 Email。' })
  }

  const admin = createClient(url, serviceKey)

  const { data: profile, error: profileErr } = await admin
    .from('profiles')
    .select('gender')
    .eq('id', user.id)
    .maybeSingle()

  if (profileErr || !profile?.gender) {
    return res.status(400).json({ ok: false, error: '請先完成個人資料性別設定。' })
  }

  const amount =
    profile.gender === 'male' ? 399 : profile.gender === 'female' ? 299 : null

  if (amount == null) {
    return res.status(400).json({ ok: false, error: '無法決定方案價格。' })
  }

  const payUrl = sandbox
    ? 'https://sandbox.tappaysdk.com/tpc/payment/pay-by-prime'
    : 'https://prod.tappaysdk.com/tpc/payment/pay-by-prime'

  const payload = {
    prime,
    partner_key: partnerKey,
    merchant_id: merchantId,
    details: `tsMedia 月費會員 (${profile.gender})`,
    amount,
    cardholder: {
      phone_number: ch.phone_number.trim(),
      name: ch.name.trim(),
      email: ch.email.trim(),
      zip_code: ch.zip_code?.trim() ?? '100',
      address: ch.address?.trim() ?? 'Taiwan',
      national_id: ch.national_id?.trim() ?? '',
    },
    remember: false,
  }

  let tapRes: Response
  try {
    tapRes = await fetch(payUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': partnerKey,
      },
      body: JSON.stringify(payload),
    })
  } catch (e) {
    console.error('[tappay-membership] Fetch error', e)
    return res.status(502).json({ ok: false, error: '金流連線失敗，請稍後再試。' })
  }

  const tapJson = (await tapRes.json()) as {
    status: number
    msg: string
    rec_trade_id?: string
  }

  if (tapJson.status !== 0) {
    console.warn('[tappay-membership] TapPay declined', tapJson)
    return res.status(400).json({
      ok: false,
      error: tapJson.msg || '付款未成功，請確認卡片或聯絡發卡行。',
    })
  }

  const { data: grantData, error: grantErr } = await admin.rpc('grant_monthly_membership_for_user', {
    p_user_id: user.id,
  })

  if (grantErr) {
    console.error('[tappay-membership] grant RPC after charge', grantErr)
    return res.status(500).json({
      ok: false,
      error: '已授權但開通失敗，請聯絡客服並提供交易序號。',
    })
  }

  const grant = grantData as { subscription_expires_at?: string; price_ntd?: number } | null

  const payRow = {
    user_id: user.id,
    provider: 'tappay',
    amount_ntd: amount,
    rec_trade_id: tapJson.rec_trade_id ?? null,
    gateway_status: tapJson.status,
  }
  const { error: insErr } = await admin.from('subscription_payment_events').insert(payRow)
  if (insErr) {
    console.error('[tappay-membership] log insert', insErr)
  }

  return res.status(200).json({
    ok: true,
    subscriptionExpiresAt: grant?.subscription_expires_at,
    priceNtd: grant?.price_ntd,
  })
}
