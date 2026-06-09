export type CreditPackKey = 'super_like_5' | 'blur_unlock_16'

export type CreditPackProduct = {
  key: CreditPackKey
  title: string
  subtitle: string
  priceNtd: number
  creditLabel: string
}

/** 金流測試用；上線前改回 false */
const PAYMENT_TEST_ONE_NTD = true

export const CREDIT_PACK_PRODUCTS: CreditPackProduct[] = [
  {
    key: 'super_like_5',
    title: '超級喜歡 x5',
    subtitle: '探索送出超級喜歡時消耗',
    priceNtd: PAYMENT_TEST_ONE_NTD ? 1 : 199,
    creditLabel: '5 次超級喜歡',
  },
  {
    key: 'blur_unlock_16',
    title: '解除拼圖 x16',
    subtitle: '配對聊天隨機解鎖對方照片拼圖',
    priceNtd: PAYMENT_TEST_ONE_NTD ? 1 : 99,
    creditLabel: '16 次解除拼圖',
  },
]

export function membershipMonthlyPriceNtd(gender: 'male' | 'female'): number {
  if (PAYMENT_TEST_ONE_NTD) return 1
  return gender === 'male' ? 399 : 299
}

export function formatMembershipExpiryZhTw(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return '尚未訂閱'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '尚未訂閱'
  if (d.getTime() <= now) return '已到期'
  return d.toLocaleString('zh-TW', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Taipei',
  })
}

export function isMembershipActive(iso: string | null | undefined, now = Date.now()): boolean {
  if (!iso) return false
  const d = new Date(iso)
  return !Number.isNaN(d.getTime()) && d.getTime() > now
}
