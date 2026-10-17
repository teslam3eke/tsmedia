export type PaymentProviderMode = 'ecpay' | 'tappay' | 'mock' | 'unavailable'

export type PaymentProviderState = {
  mode: PaymentProviderMode
  sandbox: boolean | null
  loading: boolean
}

/** 無可用金流時對使用者顯示（繁體） */
export const PAYMENT_UNAVAILABLE_USER_MESSAGE =
  '目前付款功能暫時無法使用，請稍後再試或聯絡客服。'

/**
 * 僅本機 dev 且明確 VITE_ALLOW_MOCK_PAYMENT=1 時允許 client mock RPC。
 * Production build（import.meta.env.PROD）永遠 false。
 */
export function isClientMockPaymentEnabled(): boolean {
  if (import.meta.env.PROD) return false
  return import.meta.env.VITE_ALLOW_MOCK_PAYMENT === '1'
}

export function isTapPayClientConfigured(): boolean {
  return (
    Boolean(import.meta.env.VITE_TAPPAY_APP_ID) &&
    Boolean(import.meta.env.VITE_TAPPAY_APP_KEY) &&
    Boolean(import.meta.env.VITE_TAPPAY_SERVER_TYPE)
  )
}

export function resolvePaymentProviderMode(input: {
  ecpayConfigured: boolean
  tapPayConfigured: boolean
  allowClientMockPayment: boolean
}): PaymentProviderMode {
  if (input.ecpayConfigured) return 'ecpay'
  if (input.tapPayConfigured) return 'tappay'
  if (input.allowClientMockPayment) return 'mock'
  return 'unavailable'
}

export async function fetchPaymentProvider(): Promise<Omit<PaymentProviderState, 'loading'>> {
  let ecpayConfigured = false
  let sandbox: boolean | null = null

  try {
    const res = await fetch('/api/ecpay-config', { cache: 'no-store' })
    if (res.ok) {
      const json = (await res.json()) as { configured?: boolean; sandbox?: boolean | null }
      if (json.configured) {
        ecpayConfigured = true
        sandbox = json.sandbox ?? null
      }
    }
  } catch {
    /* 本地 dev 無 API 時 fallback */
  }

  const mode = resolvePaymentProviderMode({
    ecpayConfigured,
    tapPayConfigured: isTapPayClientConfigured(),
    allowClientMockPayment: isClientMockPaymentEnabled(),
  })

  return { mode, sandbox }
}

export function paymentModeLabel(mode: PaymentProviderMode): string {
  if (mode === 'ecpay') return '綠界金流'
  if (mode === 'tappay') return 'TapPay'
  if (mode === 'mock') return '模擬付款'
  if (mode === 'unavailable') return '付款不可用'
  return '模擬付款'
}
