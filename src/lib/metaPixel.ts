const META_PIXEL_ID = (import.meta.env.VITE_META_PIXEL_ID ?? '').trim()
const REG_DEDUPE_PREFIX = 'tm_meta_reg_v1_'
const PURCHASE_DEDUPE_PREFIX = 'tm_meta_purchase_v1_'
const SUBMIT_APP_DEDUPE_PREFIX = 'tm_meta_submit_app_v1_'

export type MetaPurchaseInput = {
  orderId: string
  valueNtd: number
  productType: 'membership' | 'credit_pack'
  packKey?: string | null
}

type FbqStub = {
  (...args: unknown[]): void
  queue: unknown[]
  loaded: boolean
  version: string
  callMethod?: (...args: unknown[]) => void
}

declare global {
  interface Window {
    fbq?: FbqStub
    _fbq?: FbqStub
  }
}

function pixelEnabled(): boolean {
  return typeof window !== 'undefined' && META_PIXEL_ID.length > 0
}

function fbq(...args: unknown[]): void {
  window.fbq?.(...args)
}

/** 載入 Meta Pixel base code 並送 PageView（需設 VITE_META_PIXEL_ID）。 */
export function initMetaPixel(): void {
  if (!pixelEnabled() || window.fbq) return

  const stub: FbqStub = Object.assign(
    function (...args: unknown[]) {
      if (stub.callMethod) {
        stub.callMethod(...args)
      } else {
        stub.queue.push(args)
      }
    },
    { queue: [] as unknown[], loaded: true, version: '2.0' },
  )

  if (!window._fbq) window._fbq = stub
  window.fbq = stub

  const script = document.createElement('script')
  script.async = true
  script.src = 'https://connect.facebook.net/en_US/fbevents.js'
  const first = document.getElementsByTagName('script')[0]
  first?.parentNode?.insertBefore(script, first)

  fbq('init', META_PIXEL_ID)
  fbq('track', 'PageView')
}

export function trackMetaEvent(eventName: string, params?: Record<string, unknown>): void {
  if (!pixelEnabled()) return
  initMetaPixel()
  if (params) {
    fbq('track', eventName, params)
  } else {
    fbq('track', eventName)
  }
}

/** 註冊成功（同一 user id 只送一次，避免重複登入重複計轉換）。 */
export function trackMetaCompleteRegistration(userId?: string | null): void {
  if (!pixelEnabled()) return
  if (userId) {
    const key = `${REG_DEDUPE_PREFIX}${userId}`
    try {
      if (localStorage.getItem(key)) return
      localStorage.setItem(key, '1')
    } catch {
      /* 私密模式 */
    }
  }
  trackMetaEvent('CompleteRegistration')
}

/**
 * 送出會員審核（Meta 標準事件 SubmitApplication）。
 * 事件管理工具顯示為「Submit Application／提交申請」，語意對應「送出審核」。
 */
export function trackMetaSubmitApplication(applicationId: string): void {
  if (!pixelEnabled()) return
  const id = applicationId.trim()
  if (!id) return

  const key = `${SUBMIT_APP_DEDUPE_PREFIX}${id}`
  try {
    if (localStorage.getItem(key)) return
    localStorage.setItem(key, '1')
  } catch {
    /* 私密模式 */
  }

  initMetaPixel()
  fbq(
    'track',
    'SubmitApplication',
    {
      content_name: '會員審核',
      content_category: 'verification',
    },
    { eventID: id },
  )
}

function purchaseContentName(input: MetaPurchaseInput): string {
  if (input.productType === 'membership') return 'VIP 月卡'
  if (input.packKey === 'crown_effect') return '皇冠特效'
  return input.packKey ?? '道具'
}

/** 付款成功（同一 orderId 只送一次，避免返回／補同步／reload 重複計轉換）。 */
export function trackMetaPurchase(input: MetaPurchaseInput): void {
  if (!pixelEnabled()) return
  const orderId = input.orderId.trim()
  if (!orderId || input.valueNtd <= 0) return

  const key = `${PURCHASE_DEDUPE_PREFIX}${orderId}`
  try {
    if (localStorage.getItem(key)) return
    localStorage.setItem(key, '1')
  } catch {
    /* 私密模式 */
  }

  initMetaPixel()
  fbq(
    'track',
    'Purchase',
    {
      value: input.valueNtd,
      currency: 'TWD',
      content_type: 'product',
      content_ids: [input.packKey ?? input.productType],
      content_name: purchaseContentName(input),
    },
    { eventID: orderId },
  )
}

/** TapPay 成功回應 → Purchase（需 API 回傳 recTradeId、amountNtd）。 */
export function trackMetaPurchaseFromTapPay(
  json: { recTradeId?: string | null; amountNtd?: number | null },
  productType: 'membership' | 'credit_pack',
  packKey?: string | null,
): void {
  const orderId = json.recTradeId?.trim()
  if (!orderId || json.amountNtd == null || json.amountNtd <= 0) return
  trackMetaPurchase({
    orderId,
    valueNtd: json.amountNtd,
    productType,
    packKey,
  })
}
