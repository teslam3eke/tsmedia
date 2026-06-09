import crypto from 'node:crypto'

/** 對齊 ECPay PHP SDK UrlService::ecpayUrlEncode（.NET 編碼表） */
export function ecpayUrlEncode(source: string): string {
  const encoded = encodeURIComponent(source).replace(/%20/g, '+')
  const lower = encoded.toLowerCase()
  return lower
    .replace(/%2d/g, '-')
    .replace(/%5f/g, '_')
    .replace(/%2e/g, '.')
    .replace(/%21/g, '!')
    .replace(/%2a/g, '*')
    .replace(/%28/g, '(')
    .replace(/%29/g, ')')
}

export function buildCheckMacValue(
  params: Record<string, string>,
  hashKey: string,
  hashIV: string,
): string {
  const sortedKeys = Object.keys(params).sort((a, b) =>
    a.toLowerCase().localeCompare(b.toLowerCase()),
  )

  let raw = `HashKey=${hashKey}`
  for (const key of sortedKeys) {
    if (key === 'CheckMacValue') continue
    const val = params[key]
    // 對齊 ECPay SDK：空字串仍參與 MAC（僅略過未出現的 key）
    if (val === undefined || val === null) continue
    raw += `&${key}=${val}`
  }
  raw += `&HashIV=${hashIV}`

  const encoded = ecpayUrlEncode(raw)
  return crypto.createHash('sha256').update(encoded).digest('hex').toUpperCase()
}

export function verifyCheckMacValue(
  params: Record<string, string>,
  hashKey: string,
  hashIV: string,
): boolean {
  const received = params.CheckMacValue?.trim().toUpperCase()
  if (!received) return false
  return buildCheckMacValue(params, hashKey, hashIV) === received
}
