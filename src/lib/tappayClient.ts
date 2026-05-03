const SDK_URL = 'https://js.tappaysdk.com/sdk/tpdirect/v5.17.6'

type GetPrimeResult = { status: number; msg?: string; prime?: string }

export type TPDirectAPI = {
  setupSDK: (appId: number, appKey: string, serverType: 'sandbox' | 'production') => void
  card: {
    setup: (config: {
      fields: {
        number: { element: string; placeholder: string }
        expirationDate: { element: string; placeholder: string }
        ccv: { element: string; placeholder: string }
      }
      styles?: Record<string, Record<string, string>>
    }) => void
    getPrime: (cb: (result: GetPrimeResult) => void) => void
  }
}

declare global {
  interface Window {
    TPDirect?: TPDirectAPI
  }
}

export function loadTapPaySdk(): Promise<TPDirectAPI> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('TapPay only runs in browser'))
  }
  if (window.TPDirect) {
    return Promise.resolve(window.TPDirect)
  }
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${SDK_URL}"]`)
    if (existing) {
      existing.addEventListener('load', () => {
        if (window.TPDirect) resolve(window.TPDirect)
        else reject(new Error('TapPay SDK missing'))
      })
      existing.addEventListener('error', () => reject(new Error('TapPay SDK load failed')))
      return
    }
    const s = document.createElement('script')
    s.src = SDK_URL
    s.async = true
    s.onload = () => {
      if (!window.TPDirect) {
        reject(new Error('TapPay SDK missing'))
        return
      }
      resolve(window.TPDirect)
    }
    s.onerror = () => reject(new Error('TapPay SDK load failed'))
    document.head.appendChild(s)
  })
}

export function initTapPayCardFields(tp: TPDirectAPI, appId: number, appKey: string, serverType: 'sandbox' | 'production') {
  tp.setupSDK(appId, appKey, serverType)
  tp.card.setup({
    fields: {
      number: { element: '#tappay-card-number', placeholder: '**** **** **** ****' },
      expirationDate: { element: '#tappay-card-expiration', placeholder: 'MM / YY' },
      ccv: { element: '#tappay-card-ccv', placeholder: 'CVC' },
    },
    styles: {
      input: { 'font-size': '16px', color: '#0f172a' },
    },
  })
}

export function getCardPrime(tp: TPDirectAPI): Promise<string> {
  return new Promise((resolve, reject) => {
    tp.card.getPrime((result) => {
      if (result.status !== 0) {
        reject(new Error(result.msg || '卡片驗證失敗'))
        return
      }
      if (!result.prime) {
        reject(new Error('無法取得交易憑證'))
        return
      }
      resolve(result.prime)
    })
  })
}
