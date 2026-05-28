export type TapPayCardholder = {
  phone_number: string
  name: string
  email: string
  zip_code?: string
  address?: string
  national_id?: string
}

export async function tappayPayByPrime(params: {
  prime: string
  cardholder: TapPayCardholder
  amount: number
  details: string
  sandbox: boolean
  partnerKey: string
  merchantId: string
}): Promise<{ ok: true; recTradeId?: string; gatewayStatus: number } | { ok: false; error: string }> {
  const payUrl = params.sandbox
    ? 'https://sandbox.tappaysdk.com/tpc/payment/pay-by-prime'
    : 'https://prod.tappaysdk.com/tpc/payment/pay-by-prime'

  const payload = {
    prime: params.prime,
    partner_key: params.partnerKey,
    merchant_id: params.merchantId,
    details: params.details,
    amount: params.amount,
    cardholder: {
      phone_number: params.cardholder.phone_number.trim(),
      name: params.cardholder.name.trim(),
      email: params.cardholder.email.trim(),
      zip_code: params.cardholder.zip_code?.trim() ?? '100',
      address: params.cardholder.address?.trim() ?? 'Taiwan',
      national_id: params.cardholder.national_id?.trim() ?? '',
    },
    remember: false,
  }

  let tapRes: Response
  try {
    tapRes = await fetch(payUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': params.partnerKey,
      },
      body: JSON.stringify(payload),
    })
  } catch {
    return { ok: false, error: '金流連線失敗，請稍後再試。' }
  }

  const tapJson = (await tapRes.json()) as {
    status: number
    msg: string
    rec_trade_id?: string
  }

  if (tapJson.status !== 0) {
    return {
      ok: false,
      error: tapJson.msg || '付款未成功，請確認卡片或聯絡發卡行。',
    }
  }

  return {
    ok: true,
    recTradeId: tapJson.rec_trade_id,
    gatewayStatus: tapJson.status,
  }
}

export function readTapPayServerConfig():
  | { ok: true; url: string; anon: string; serviceKey: string; partnerKey: string; merchantId: string; sandbox: boolean }
  | { ok: false; error: string } {
  const url = process.env.SUPABASE_URL
  const anon = process.env.SUPABASE_ANON_KEY
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const partnerKey = process.env.TAPPAY_PARTNER_KEY
  const merchantId = process.env.TAPPAY_MERCHANT_ID
  const sandbox = process.env.TAPPAY_SANDBOX !== 'false'

  if (!url || !anon || !serviceKey || !partnerKey || !merchantId) {
    return { ok: false, error: '伺服器未設定金流（環境變數）。' }
  }

  return { ok: true, url, anon, serviceKey, partnerKey, merchantId, sandbox }
}

export async function readAuthedUserId(
  req: { headers: { authorization?: string | string[] } },
  url: string,
  anon: string,
): Promise<{ ok: true; userId: string } | { ok: false; status: number; error: string }> {
  const authHeader = req.headers.authorization
  const token =
    typeof authHeader === 'string' && authHeader.startsWith('Bearer ')
      ? authHeader.slice(7)
      : null

  if (!token) {
    return { ok: false, status: 401, error: '請重新登入後再試。' }
  }

  const { createClient } = await import('@supabase/supabase-js')
  const userClient = createClient(url, anon)
  const {
    data: { user },
    error: userErr,
  } = await userClient.auth.getUser(token)

  if (userErr || !user) {
    return { ok: false, status: 401, error: '登入已過期，請重新登入。' }
  }

  return { ok: true, userId: user.id }
}
