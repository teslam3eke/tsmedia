export type EcpayConfig = {
  merchantId: string
  hashKey: string
  hashIV: string
  sandbox: boolean
  siteUrl: string
  gatewayUrl: string
  notifyUrl: string
  returnUrl: string
  clientBackUrl: string
  supabaseUrl: string
  supabaseAnonKey: string
  supabaseServiceKey: string
}

export function getSiteUrl(): string {
  const raw =
    process.env.ECPAY_SITE_URL?.trim() ||
    process.env.VITE_SITE_URL?.trim() ||
    'https://www.tsmedia.tw'
  return raw.replace(/\/$/, '')
}

export function readEcpayConfig(requireSupabase = true):
  | { ok: true; cfg: EcpayConfig }
  | { ok: false; error: string } {
  const merchantId = process.env.ECPAY_MERCHANT_ID?.trim()
  const hashKey = process.env.ECPAY_HASH_KEY?.trim()
  const hashIV = process.env.ECPAY_HASH_IV?.trim()
  const sandbox = process.env.ECPAY_SANDBOX !== 'false'
  const siteUrl = getSiteUrl()

  const supabaseUrl =
    process.env.SUPABASE_URL?.trim() || process.env.VITE_SUPABASE_URL?.trim()
  const supabaseAnonKey =
    process.env.SUPABASE_ANON_KEY?.trim() || process.env.VITE_SUPABASE_ANON_KEY?.trim()
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()

  if (!merchantId || !hashKey || !hashIV) {
    return { ok: false, error: '伺服器未設定綠界金流（ECPAY_* 環境變數）。' }
  }

  if (requireSupabase) {
    if (!supabaseServiceKey) {
      return { ok: false, error: '伺服器未設定 SUPABASE_SERVICE_ROLE_KEY（Vercel 環境變數）。' }
    }
    if (!supabaseUrl || !supabaseAnonKey) {
      return {
        ok: false,
        error: '伺服器未設定 Supabase URL／ANON（SUPABASE_URL 或 VITE_SUPABASE_URL 等）。',
      }
    }
  }

  const gatewayUrl = sandbox
    ? 'https://payment-stage.ecpay.com.tw/Cashier/AioCheckOut/V5'
    : 'https://payment.ecpay.com.tw/Cashier/AioCheckOut/V5'

  return {
    ok: true,
    cfg: {
      merchantId,
      hashKey,
      hashIV,
      sandbox,
      siteUrl,
      gatewayUrl,
      notifyUrl: `${siteUrl}/api/ecpay-notify`,
      returnUrl: `${siteUrl}/api/ecpay-return`,
      clientBackUrl: `${siteUrl}/?payment=cancel`,
      supabaseUrl: supabaseUrl ?? '',
      supabaseAnonKey: supabaseAnonKey ?? '',
      supabaseServiceKey: supabaseServiceKey ?? '',
    },
  }
}
