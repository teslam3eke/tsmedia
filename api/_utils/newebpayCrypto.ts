import crypto from 'node:crypto'

/** 藍新 MPG：TradeInfo AES-256-CBC（hex）＋ TradeSha SHA256 */
export function encryptTradeInfo(plain: string, hashKey: string, hashIV: string): string {
  const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(hashKey, 'utf8'), Buffer.from(hashIV, 'utf8'))
  let encrypted = cipher.update(encodeURIComponent(plain), 'utf8', 'hex')
  encrypted += cipher.final('hex')
  return encrypted
}

export function decryptTradeInfo(tradeInfoHex: string, hashKey: string, hashIV: string): string {
  const decipher = crypto.createDecipheriv(
    'aes-256-cbc',
    Buffer.from(hashKey, 'utf8'),
    Buffer.from(hashIV, 'utf8'),
  )
  let decrypted = decipher.update(tradeInfoHex, 'hex', 'utf8')
  decrypted += decipher.final('utf8')
  return decodeURIComponent(decrypted)
}

export function buildTradeSha(tradeInfo: string, hashKey: string, hashIV: string): string {
  return crypto
    .createHash('sha256')
    .update(`HashKey=${hashKey}&${tradeInfo}&HashIV=${hashIV}`)
    .digest('hex')
    .toUpperCase()
}

export function verifyTradeSha(tradeInfo: string, tradeSha: string, hashKey: string, hashIV: string): boolean {
  return buildTradeSha(tradeInfo, hashKey, hashIV) === tradeSha.trim().toUpperCase()
}

/** 解密後 `Status=SUCCESS&Result={...}` 形式 */
export function parseTradeInfoPlain(plain: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const part of plain.split('&')) {
    const eq = part.indexOf('=')
    if (eq <= 0) continue
    const key = part.slice(0, eq)
    const val = part.slice(eq + 1)
    try {
      out[key] = decodeURIComponent(val.replace(/\+/g, ' '))
    } catch {
      out[key] = val
    }
  }
  return out
}

export function buildMpgTradeQuery(fields: Record<string, string | number>): string {
  return Object.entries(fields)
    .filter(([, v]) => v !== '' && v !== undefined && v !== null)
    .map(([k, v]) => `${k}=${v}`)
    .join('&')
}
