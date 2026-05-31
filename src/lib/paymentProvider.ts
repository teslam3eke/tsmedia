export type PaymentProviderMode = 'newebpay' | 'tappay' | 'mock'

export type PaymentProviderState = {
  mode: PaymentProviderMode
  sandbox: boolean | null
  loading: boolean
}

export function isTapPayClientConfigured(): boolean {
  return (
    Boolean(import.meta.env.VITE_TAPPAY_APP_ID) &&
    Boolean(import.meta.env.VITE_TAPPAY_APP_KEY) &&
    Boolean(import.meta.env.VITE_TAPPAY_SERVER_TYPE)
  )
}

export async function fetchPaymentProvider(): Promise<Omit<PaymentProviderState, 'loading'>> {
  try {
    const res = await fetch('/api/newebpay-config', { cache: 'no-store' })
    if (res.ok) {
      const json = (await res.json()) as { configured?: boolean; sandbox?: boolean | null }
      if (json.configured) {
        return { mode: 'newebpay', sandbox: json.sandbox ?? null }
      }
    }
  } catch {
    /* 本地 dev 無 API 時 fallback */
  }

  if (isTapPayClientConfigured()) {
    return { mode: 'tappay', sandbox: null }
  }

  return { mode: 'mock', sandbox: null }
}

export function paymentModeLabel(mode: PaymentProviderMode): string {
  if (mode === 'newebpay') return '藍新金流'
  if (mode === 'tappay') return 'TapPay'
  return '模擬付款'
}
