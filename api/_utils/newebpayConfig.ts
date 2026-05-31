export type NewebPayConfig = {
  merchantId: string
  hashKey: string
  hashIV: string
  sandbox: boolean
  siteUrl: string
  gatewayUrl: string
  notifyUrl: string
  returnUrl: string
  supabaseUrl: string
  supabaseAnonKey: string
  supabaseServiceKey: string
}

export function getSiteUrl(): string {
  const raw =
    process.env.NEWEBPAY_SITE_URL?.trim() ||
    process.env.VITE_SITE_URL?.trim() ||
    'https://www.tsmedia.tw'
  return raw.replace(/\/$/, '')
}

export function readNewebPayConfig(requireSupabase = true):
  | { ok: true; cfg: NewebPayConfig }
  | { ok: false; error: string } {
  const merchantId = process.env.NEWEBPAY_MERCHANT_ID?.trim()
  const hashKey = process.env.NEWEBPAY_HASH_KEY?.trim()
  const hashIV = process.env.NEWEBPAY_HASH_IV?.trim()
  const sandbox = process.env.NEWEBPAY_SANDBOX !== 'false'
  const siteUrl = getSiteUrl()

  const supabaseUrl = process.env.SUPABASE_URL?.trim()
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY?.trim()
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()

  if (!merchantId || !hashKey || !hashIV) {
    return { ok: false, error: '伺服器未設定藍新金流（NEWEBPAY_* 環境變數）。' }
  }

  if (hashKey.length !== 32) {
    return { ok: false, error: 'NEWEBPAY_HASH_KEY 須為 32 字元。' }
  }

  if (hashIV.length !== 16) {
    return { ok: false, error: 'NEWEBPAY_HASH_IV 須為 16 字元。' }
  }

  if (requireSupabase && (!supabaseUrl || !supabaseAnonKey || !supabaseServiceKey)) {
    return { ok: false, error: '伺服器未設定 Supabase 環境變數。' }
  }

  const gatewayUrl = sandbox
    ? 'https://ccore.newebpay.com/MPG/mpg_gateway'
    : 'https://core.newebpay.com/MPG/mpg_gateway'

  return {
    ok: true,
    cfg: {
      merchantId,
      hashKey,
      hashIV,
      sandbox,
      siteUrl,
      gatewayUrl,
      notifyUrl: `${siteUrl}/api/newebpay-notify`,
      returnUrl: `${siteUrl}/api/newebpay-return`,
      supabaseUrl: supabaseUrl ?? '',
      supabaseAnonKey: supabaseAnonKey ?? '',
      supabaseServiceKey: supabaseServiceKey ?? '',
    },
  }
}

export function makeMerchantOrderNo(): string {
  const ts = Date.now().toString(36).toUpperCase()
  const rand = Math.random().toString(36).slice(2, 8).toUpperCase()
  return `TM${ts}${rand}`.slice(0, 30)
}
