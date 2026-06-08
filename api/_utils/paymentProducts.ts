export const CREDIT_PACKS: Record<string, { amount: number; details: string; itemName: string }> = {
  super_like_5: {
    amount: 199,
    details: 'tsMedia 加購：超級喜歡 x5',
    itemName: '超級喜歡 x5',
  },
  blur_unlock_16: {
    amount: 99,
    details: 'tsMedia 加購：解除拼圖 x16',
    itemName: '解除拼圖 x16',
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
