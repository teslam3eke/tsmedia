const COMPANY_NAME_PATTERNS: RegExp[] = [
  /台積電/g,
  /台灣積體電路/g,
  /聯發科/g,
  /\bTSMC\b/gi,
  /\bMediaTek\b/gi,
  /\bMTK\b/g,
]

const VERIFIED_EMPLOYER_LABEL = '頂尖企業'

/** verify-id 回傳給前端的 message／reason 不可含特定公司名或「合作企業」等表述 */
export function sanitizeVerificationUserMessage(message: string | null | undefined): string {
  if (!message) return ''
  let out = message.replace(/合作企業/g, VERIFIED_EMPLOYER_LABEL)
  for (const pattern of COMPANY_NAME_PATTERNS) {
    out = out.replace(pattern, VERIFIED_EMPLOYER_LABEL)
  }
  return out
    .replace(/頂尖企業或頂尖企業/g, VERIFIED_EMPLOYER_LABEL)
    .replace(/不是頂尖企業或頂尖企業/g, '不符合頂尖企業限定')
    .replace(/為頂尖企業或頂尖企業/g, '符合頂尖企業限定')
}
