import type { AutoTextRejectPresetId } from './verificationRejectPresetMessages.js'

export const TEXT_REVIEW_TURNING_POINT_QUESTION_ID = 9000

export type TextReviewReason =
  | 'no_valid_content'
  | 'repeat_stuffing'
  | 'perfunctory'
  | 'ig'
  | 'contact'
  | 'gibberish'
  | 'ads'

export type TextReviewVerdict = 'PASS' | 'NEEDS_EDIT'

export type QuestionnaireEntryInput = { id: number; answer?: string | null }

export type TextProfileReviewResult = {
  verdict: TextReviewVerdict
  presetId: AutoTextRejectPresetId | null
  reasons: TextReviewReason[]
  /** 供前端提示（自傳 / 問卷） */
  fields: ('bio' | 'questionnaire')[]
}

const REASON_TO_PRESET: Record<TextReviewReason, AutoTextRejectPresetId> = {
  no_valid_content: 'bio_too_short',
  perfunctory: 'bio_too_short',
  gibberish: 'bio_too_short',
  repeat_stuffing: 'text_repeat_stuffing',
  ig: 'text_off_platform',
  contact: 'text_off_platform',
  ads: 'text_off_platform',
}

const PERFUNCTORY_EXACT = new Set([
  '無', '沒有', '沒', '不知道', '不知道寫什麼', '隨便', '都可以', '沒什麼', '沒什麼好說的',
  '之後再說', '認識就知道', '聊了就知道', '問我就知道', '秘密', '懶得寫',
])

const KEYBOARD_MASH = ['asdfghjkl', 'qwertyui', 'qwertyuiop', '123456789', '12345678']

const AD_STRONG = [
  /加密貨幣|比特幣|虛擬貨幣|投資群|跟單|帶單|理財群|殺豬盤|邀你入群|加群領/i,
  /微商|直銷|加盟招商|限時優惠.{0,6}(下單|購買|連結)/i,
  /(?:私訊|點連結|掃碼).{0,8}(購買|下單|加入群)/i,
]

function stripForExact(s: string): string {
  return s.trim().replace(/[\s\u3000]+/g, '').replace(/[，。！？、,.!?;:'"「」『』（）()[\]{}~`\-_/\\|@#￥$%^&*+=<>]/g, '').toLowerCase()
}

function hasLanguageContent(s: string): boolean {
  const t = s.trim()
  if (!t) return false
  if (/[\u4e00-\u9fff]/.test(t)) return true
  if (/[\u3040-\u30ff\uac00-\ud7af]/.test(t)) return true
  if (/[a-zA-Z]{2,}/.test(t)) return true
  return false
}

function isOnlyNoise(s: string): boolean {
  const t = s.trim()
  if (!t) return true
  if (!hasLanguageContent(t)) {
    const withoutPunct = t.replace(/[\s\p{P}\p{S}\p{M}]/gu, '')
    if (!withoutPunct) return true
    if (/^\d+$/.test(withoutPunct)) return true
    return true
  }
  return false
}

function hasRepeatStuffing(s: string): boolean {
  const t = s.trim()
  if (!t) return false
  /** 同一字元（含數字、符號、中文）連續 4 個以上；不含空白／換行 */
  return /([^\s\n\r])\1{3,}/u.test(t)
}

function isPerfunctoryWhole(s: string): boolean {
  const norm = stripForExact(s)
  if (!norm) return false
  return PERFUNCTORY_EXACT.has(norm)
}

function hasIg导流(s: string): boolean {
  const t = s
  if (/在\s*(ig|IG|instagram|哀居|唉居)\s*(看到|刷到|點|滑到).{0,12}(廣告|這個平台|這裡)/i.test(t)) return false
  if (/instagram\.com\/[a-zA-Z0-9._]+/i.test(t)) return true
  if (/@[a-zA-Z0-9._]{3,}/.test(t)) return true
  const igWord = /(?:ig|instagram|insta|哀居|唉居)/i
  const intent = /(?:加我|加我的|我的|私訊|追蹤|搜尋|去|找|follow|追我|傳我)/i
  if (intent.test(t) && igWord.test(t) && /(?:ig|instagram|insta|哀居|唉居).{0,12}(?:帳|帳號|id|ID|@)/i.test(t)) return true
  if (/(?:ig|instagram|insta|哀居|唉居)\s*[:：]\s*[a-zA-Z0-9._]{2,}/i.test(t)) return true
  if (/(?:IG\s*搜尋|搜尋\s*IG|加我\s*IG|去\s*IG\s*找|我的\s*IG\s*是)/i.test(t)) return true
  if (/\bfollow\s+me\s+on\s+instagram\b/i.test(t)) return true
  return false
}

function hasContact(s: string): boolean {
  const t = s
  if (/\bline\s*id\b|\bline\s*@\b|加賴|加賴\s*id|賴\s*id|我的賴|telegram|微信|wechat|whatsapp/i.test(t)) return true
  if (/\bline\s*[:：@]\s*[a-zA-Z0-9._-]{4,}/i.test(t)) return true
  if (/(?:^|[^\d])09\d{8}(?:[^\d]|$)/.test(t.replace(/\s/g, ''))) return true
  if (/\+886\s*\d/.test(t)) return true
  if (/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/.test(t)) return true
  if (/(?:https?:\/\/|www\.)[^\s]+/i.test(t)) return true
  if (/\btg\s*[:：@]\s*[a-zA-Z0-9._-]{3,}/i.test(t)) return true
  return false
}

function hasGibberish(s: string): boolean {
  const norm = stripForExact(s)
  if (!norm) return false
  const lower = norm.toLowerCase()
  for (const m of KEYBOARD_MASH) {
    if (lower === m || (lower.includes(m) && s.trim().length <= m.length + 4)) return true
  }
  return false
}

function checkAds(s: string): boolean {
  for (const re of AD_STRONG) {
    const m = s.match(re)
    if (!m || m.index === undefined) continue
    const window = s.slice(Math.max(0, m.index - 24), m.index + m[0].length + 24)
    if (/不碰|不要|勿|拒絕|請勿|沒有在|不談|不涉及|不打擾/.test(window)) continue
    return true
  }
  return (s.match(/(?:https?:\/\/|www\.)[^\s]+/gi) ?? []).length >= 2
}

function evaluateField(
  text: string,
  isBio: boolean,
): { verdict: TextReviewVerdict; reasons: TextReviewReason[] } {
  const reasons: TextReviewReason[] = []
  const trimmed = (text ?? '').trim()
  if (isBio && !trimmed) return { verdict: 'PASS', reasons: [] }
  if (!isBio && isOnlyNoise(trimmed)) reasons.push('no_valid_content')
  if (trimmed && hasRepeatStuffing(trimmed)) reasons.push('repeat_stuffing')
  if (trimmed && isPerfunctoryWhole(trimmed)) reasons.push('perfunctory')
  if (trimmed && hasIg导流(trimmed)) reasons.push('ig')
  if (trimmed && hasContact(trimmed)) reasons.push('contact')
  if (trimmed && hasGibberish(trimmed)) reasons.push('gibberish')
  if (trimmed && checkAds(trimmed)) reasons.push('ads')
  return reasons.length ? { verdict: 'NEEDS_EDIT', reasons } : { verdict: 'PASS', reasons: [] }
}

function parseQuestionnaire(raw: unknown): QuestionnaireEntryInput[] {
  if (!Array.isArray(raw)) return []
  const out: QuestionnaireEntryInput[] = []
  for (const item of raw) {
    const row = item as { id?: number; answer?: string | null }
    const id = typeof row.id === 'number' ? row.id : Number(row.id)
    if (!Number.isFinite(id) || id === TEXT_REVIEW_TURNING_POINT_QUESTION_ID) continue
    out.push({ id, answer: typeof row.answer === 'string' ? row.answer : '' })
  }
  return out
}

function pickPrimaryReason(reasons: TextReviewReason[]): TextReviewReason | null {
  const order: TextReviewReason[] = [
    'repeat_stuffing',
    'ig',
    'contact',
    'ads',
    'gibberish',
    'perfunctory',
    'no_valid_content',
  ]
  for (const r of order) {
    if (reasons.includes(r)) return r
  }
  return reasons[0] ?? null
}

/** 自傳可空白；問卷（排除轉捩點題）逐題檢查。 */
export function reviewTextProfile(bio: string | null, questionnaire: unknown): TextProfileReviewResult {
  const allReasons: TextReviewReason[] = []
  const fields = new Set<'bio' | 'questionnaire'>()

  const bioR = evaluateField(bio ?? '', true)
  if (bioR.verdict === 'NEEDS_EDIT') {
    allReasons.push(...bioR.reasons)
    fields.add('bio')
  }

  for (const q of parseQuestionnaire(questionnaire)) {
    const qR = evaluateField(q.answer ?? '', false)
    if (qR.verdict === 'NEEDS_EDIT') {
      allReasons.push(...qR.reasons)
      fields.add('questionnaire')
    }
  }

  const uniqueReasons = [...new Set(allReasons)]
  if (uniqueReasons.length === 0) {
    return { verdict: 'PASS', presetId: null, reasons: [], fields: [] }
  }

  const primary = pickPrimaryReason(uniqueReasons)
  const presetId = primary ? REASON_TO_PRESET[primary] : 'bio_too_short'
  return {
    verdict: 'NEEDS_EDIT',
    presetId,
    reasons: uniqueReasons,
    fields: [...fields],
  }
}
