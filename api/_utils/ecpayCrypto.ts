import crypto from 'node:crypto'

/** 綠界 CheckMacValue 專用 URL encode（與 encodeURIComponent 略有不同） */
export function ecpayUrlEncode(value: string): string {
  return encodeURIComponent(value)
    .replace(/%20/g, '+')
    .replace(/!/g, '%21')
    .replace(/'/g, '%27')
    .replace(/\(/g, '%28')
    .replace(/\)/g, '%29')
    .replace(/\*/g, '%2a')
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
    if (val === undefined || val === '') continue
    raw += `&${key}=${val}`
  }
  raw += `&HashIV=${hashIV}`

  const encoded = ecpayUrlEncode(raw).toLowerCase()
  return crypto.createHash('sha256').update(encoded).digest('hex').toUpperCase()
}

export function verifyCheckMacValue(
  params: Record<string, string>,
  hashKey: string,
  hashIV: string,
): boolean {
  const received = params.CheckMacValue?.trim().toUpperCase()
  if (!received) return false
  const { CheckMacValue: _drop, ...rest } = params
  const computed = buildCheckMacValue(rest, hashKey, hashIV)
  return received === computed
}
