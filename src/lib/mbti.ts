/** MBTI 四字母類型（探索卡、個資編輯） */

export const MBTI_TYPES = [
  'INTJ', 'INTP', 'ENTJ', 'ENTP',
  'INFJ', 'INFP', 'ENFJ', 'ENFP',
  'ISTJ', 'ISFJ', 'ESTJ', 'ESFJ',
  'ISTP', 'ISFP', 'ESTP', 'ESFP',
] as const

export type MbtiType = (typeof MBTI_TYPES)[number]

const MBTI_RE = /^[EI][NS][FT][JP]$/

export function isValidMbtiType(value: string | null | undefined): value is MbtiType {
  return typeof value === 'string' && MBTI_RE.test(value)
}

export function profileHasMbti(profile: { mbti_type?: string | null } | null | undefined): boolean {
  return isValidMbtiType(profile?.mbti_type ?? null)
}

/** 探索卡／詳情：無 MBTI 或格式無效時回傳 undefined（不顯示、不拋錯） */
export function normalizeMbtiTypeForDisplay(value: string | null | undefined): MbtiType | undefined {
  return isValidMbtiType(value) ? value : undefined
}
