import type { Company } from '@/lib/types'

/** DB／AI 內部值是否為已支援的認證企業 */
export function parseCompany(value: string | null | undefined): Company | null {
  return value === 'TSMC' || value === 'MediaTek' ? value : null
}

export function isVerifiedCompany(value: string | null | undefined): boolean {
  return parseCompany(value) !== null
}

/** 前端顯示：不露出 TSMC／MediaTek 等內部代碼 */
export function companyBadgeLabel(_company: string | null | undefined): string {
  return '已認證'
}

/** 個人／聊天副標：隱藏公司代碼，僅顯示已認證 + 職稱 */
export function formatProfileWorkLine(
  company: string | null | undefined,
  jobTitle: string | null | undefined,
): string {
  const role = jobTitle?.trim()
  if (isVerifiedCompany(company)) {
    return role ? `已認證 · ${role}` : '已認證'
  }
  return role || '會員'
}

/** 送審用：優先 AI 判定，其次 profile 既有值 */
export function resolveEmploymentCompany(
  aiCompany: Company | null | undefined,
  profileCompany: string | null | undefined,
): Company | null {
  return parseCompany(aiCompany) ?? parseCompany(profileCompany)
}

const COMPANY_NAME_PATTERNS: RegExp[] = [
  /台積電/g,
  /台灣積體電路/g,
  /聯發科/g,
  /\bTSMC\b/gi,
  /\bMediaTek\b/gi,
  /\bMTK\b/g,
]

/** 取代特定公司名稱時的通用詞（勿用「合作企業」等易被解讀為官方合作之表述） */
export const VERIFIED_EMPLOYER_LABEL = '頂尖企業'

/** 使用者可見文案：移除特定公司名稱（含 API／通知／後台理由） */
export function sanitizeVerificationUserMessage(message: string | null | undefined): string {
  if (!message) return ''
  let out = message.replace(/合作企業/g, VERIFIED_EMPLOYER_LABEL)
  for (const pattern of COMPANY_NAME_PATTERNS) {
    out = out.replace(pattern, VERIFIED_EMPLOYER_LABEL)
  }
  out = out
    .replace(/[。.]?AI 審核時間：約 \d+ 秒。?/g, '。')
    .replace(/[。.]?等待時間約\s*\d+\s*秒。?/g, '。')
    .replace(/。+/g, '。')
    .replace(/。$/g, '')
  return out
    .replace(/頂尖企業或頂尖企業/g, VERIFIED_EMPLOYER_LABEL)
    .replace(/不是頂尖企業或頂尖企業/g, '不符合頂尖企業限定')
    .replace(/為頂尖企業或頂尖企業/g, '符合頂尖企業限定')
}

/** 管理後台：不顯示內部代碼 */
export function adminVerificationCompanyLabel(company: string | null | undefined): string {
  return isVerifiedCompany(company) ? '頂尖企業（已辨識）' : '未辨識'
}
