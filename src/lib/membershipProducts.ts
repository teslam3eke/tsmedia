export const MEMBERSHIP_LIST_PRICE_NTD = { male: 399, female: 299 } as const

export const PACK_LIST_PRICE_NTD = {
  heart_5: 149,
  super_like_5: 199,
  blur_unlock_16: 99,
  crown_effect: 299,
} as const

export type CreditPackKey = 'heart_5' | 'super_like_5' | 'blur_unlock_16'

export const CROWN_EFFECT_PACK_KEY = 'crown_effect' as const

export type CreditPackProduct = {
  key: CreditPackKey
  title: string
  subtitle: string
  listPriceNtd: number
  creditLabel: string
}

export const CREDIT_PACK_PRODUCTS: CreditPackProduct[] = [
  {
    key: 'heart_5',
    title: '愛心 x10',
    subtitle: '探索送出喜歡、男性即時加好友時消耗',
    listPriceNtd: PACK_LIST_PRICE_NTD.heart_5,
    creditLabel: '10 顆愛心',
  },
  {
    key: 'super_like_5',
    title: '超級喜歡 x5',
    subtitle: '探索送出超級喜歡時消耗',
    listPriceNtd: PACK_LIST_PRICE_NTD.super_like_5,
    creditLabel: '5 次超級喜歡',
  },
  {
    key: 'blur_unlock_16',
    title: '解除拼圖 x16',
    subtitle: '配對聊天隨機解鎖對方照片拼圖',
    listPriceNtd: PACK_LIST_PRICE_NTD.blur_unlock_16,
    creditLabel: '16 次解除拼圖',
  },
]

/** 皇冠特效：男性限購一次、永久解鎖；正式價 299。 */
export const CROWN_EFFECT_PRODUCT = {
  key: CROWN_EFFECT_PACK_KEY,
  title: '皇冠特效',
  subtitle: '個人頁皇冠動態特效（永久解鎖，限購一次）',
  usageNote: '須完成收入認證審核通過後方可使用',
  listPriceNtd: PACK_LIST_PRICE_NTD.crown_effect,
  purchaseLabel: '皇冠特效（永久）',
} as const

export function isCrownEffectPurchased(purchasedAt: string | null | undefined): boolean {
  return Boolean(purchasedAt)
}

/** 男性須購買皇冠特效道具後才可啟用；女性僅需收入認證。 */
export function canEnableCrownEffect(profile: {
  gender: 'male' | 'female' | null
  crown_effect_purchased_at?: string | null
}): boolean {
  if (profile.gender !== 'male') return true
  return isCrownEffectPurchased(profile.crown_effect_purchased_at)
}

export function effectiveShowIncomeBorder(profile: {
  gender: 'male' | 'female' | null
  show_income_border?: boolean | null
  income_tier?: string | null
  crown_effect_purchased_at?: string | null
} | null | undefined): boolean {
  if (!profile) return false
  return Boolean(
    profile.show_income_border &&
    profile.income_tier &&
    canEnableCrownEffect(profile),
  )
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
