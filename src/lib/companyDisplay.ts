import type { LegacyVerifiedCompany } from '@/lib/types'

/** DB／AI 內部值是否為舊版 TSMC／MediaTek 認證企業 */
export function parseCompany(value: string | null | undefined): LegacyVerifiedCompany | null {
  return value === 'TSMC' || value === 'MediaTek' ? value : null
}

/** 是否為舊版頂尖企業代碼（新流程改以 profile.is_verified 為準） */
export function isVerifiedCompany(value: string | null | undefined): boolean {
  return parseCompany(value) !== null
}

/** 前端顯示：已通過身分／任職審核 */
export function companyBadgeLabel(_company: string | null | undefined): string {
  return '已認證'
}

/** 個人／聊天副標：顯示任職公司與職稱 */
export function formatProfileWorkLine(
  company: string | null | undefined,
  jobTitle: string | null | undefined,
  opts?: { isVerified?: boolean },
): string {
  const role = jobTitle?.trim()
  const org = company?.trim()
  if (opts?.isVerified && org) {
    return role ? `${org} · ${role}` : org
  }
  if (opts?.isVerified) {
    return role ? `已認證 · ${role}` : '已認證'
  }
  return role || org || '會員'
}

/** 送審用：優先 AI 判定，其次 profile 既有值（legacy） */
export function resolveEmploymentCompany(
  aiCompany: LegacyVerifiedCompany | null | undefined,
  profileCompany: string | null | undefined,
): LegacyVerifiedCompany | null {
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
