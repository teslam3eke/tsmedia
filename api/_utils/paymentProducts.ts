/** 金流測試用；上線前設 PAYMENT_TEST_MODE = false */
export const PAYMENT_TEST_MODE = true

/** 測試期 2 折（原價 × 0.2） */
export const PAYMENT_TEST_DISCOUNT_FACTOR = 0.2

export const MEMBERSHIP_LIST_PRICE_NTD = { male: 399, female: 299 } as const

export const PACK_LIST_PRICE_NTD = {
  heart_5: 149,
  super_like_5: 199,
  blur_unlock_16: 99,
  crown_effect: 299,
} as const

export type CreditPackKey = keyof typeof PACK_LIST_PRICE_NTD

export function effectivePriceNtd(listPriceNtd: number): number {
  if (!PAYMENT_TEST_MODE) return listPriceNtd
  return Math.max(1, Math.round(listPriceNtd * PAYMENT_TEST_DISCOUNT_FACTOR))
}

export function membershipAmountNtd(gender: 'male' | 'female'): number {
  return effectivePriceNtd(MEMBERSHIP_LIST_PRICE_NTD[gender])
}

function packAmount(key: Exclude<CreditPackKey, 'crown_effect'>) {
  return effectivePriceNtd(PACK_LIST_PRICE_NTD[key])
}

export const CREDIT_PACKS: Record<
  CreditPackKey,
  { amount: number; listPriceNtd: number; details: string; itemName: string }
> = {
  heart_5: {
    amount: packAmount('heart_5'),
    listPriceNtd: PACK_LIST_PRICE_NTD.heart_5,
    details: 'tsMedia 加購：愛心 x5',
    itemName: '愛心 x5',
  },
  super_like_5: {
    amount: packAmount('super_like_5'),
    listPriceNtd: PACK_LIST_PRICE_NTD.super_like_5,
    details: 'tsMedia 加購：超級喜歡 x5',
    itemName: '超級喜歡 x5',
  },
  blur_unlock_16: {
    amount: packAmount('blur_unlock_16'),
    listPriceNtd: PACK_LIST_PRICE_NTD.blur_unlock_16,
    details: 'tsMedia 加購：解除拼圖 x16',
    itemName: '解除拼圖 x16',
  },
  crown_effect: {
    amount: effectivePriceNtd(PACK_LIST_PRICE_NTD.crown_effect),
    listPriceNtd: PACK_LIST_PRICE_NTD.crown_effect,
    details: 'tsMedia 加購：皇冠特效（永久）',
    itemName: '皇冠特效',
  },
}

/** 綠界 MerchantTradeNo 上限 20 字元（英數） */
export function makeMerchantTradeNo(): string {
  const ts = Date.now().toString(36).toUpperCase()
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase()
  return `TS${ts}${rand}`.replace(/[^A-Z0-9]/gi, '').slice(0, 20)
}

export function formatEcpayMerchantTradeDate(date = new Date()): string {
  const parts = new Intl.DateTimeFormat('zh-TW', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date)
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '00'
  return `${get('year')}/${get('month')}/${get('day')} ${get('hour')}:${get('minute')}:${get('second')}`
}
