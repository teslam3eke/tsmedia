import { type MbtiType } from '@/lib/mbti'

export type MbtiDimension = 'EI' | 'SN' | 'TF' | 'JP'
export type MbtiLetter = 'E' | 'I' | 'S' | 'N' | 'T' | 'F' | 'J' | 'P'
export type MbtiChoice = 'A' | 'B'

export interface MbtiQuestion {
  id: number
  text: string
  optionA: { label: string; letter: MbtiLetter }
  optionB: { label: string; letter: MbtiLetter }
  dimension: MbtiDimension
}

/** 入門測驗 10 題：每個維度 2 題，同分時偏 E／S／T／J */
export const MBTI_QUESTIONS: MbtiQuestion[] = [
  {
    id: 1,
    dimension: 'EI',
    text: '週末比較想怎麼充電？',
    optionA: { label: '跟朋友聚會、認識新朋友', letter: 'E' },
    optionB: { label: '獨處或只跟一兩個熟朋友相處', letter: 'I' },
  },
  {
    id: 2,
    dimension: 'EI',
    text: '在陌生場合，你通常會…',
    optionA: { label: '主動開話題、很快融入', letter: 'E' },
    optionB: { label: '先觀察環境，再慢慢加入', letter: 'I' },
  },
  {
    id: 3,
    dimension: 'SN',
    text: '做決定時，你更相信…',
    optionA: { label: '親眼看到的事實與過往經驗', letter: 'S' },
    optionB: { label: '直覺、可能性與整體想像', letter: 'N' },
  },
  {
    id: 4,
    dimension: 'SN',
    text: '聊天時你比較喜歡談…',
    optionA: { label: '具體發生過的事、細節與計畫', letter: 'S' },
    optionB: { label: '想法、意義、未來可能', letter: 'N' },
  },
  {
    id: 5,
    dimension: 'TF',
    text: '朋友向你訴苦，你第一反應是…',
    optionA: { label: '分析問題、提供解決方向', letter: 'T' },
    optionB: { label: '先同理感受、給情緒支持', letter: 'F' },
  },
  {
    id: 6,
    dimension: 'TF',
    text: '團隊意見不合時，你較在意…',
    optionA: { label: '哪個方案最合理、最有效率', letter: 'T' },
    optionB: { label: '大家感受是否被顧到、關係和諧', letter: 'F' },
  },
  {
    id: 7,
    dimension: 'JP',
    text: '出遊前你通常…',
    optionA: { label: '先排好行程、訂好細節', letter: 'J' },
    optionB: { label: '保留彈性，到現場再決定', letter: 'P' },
  },
  {
    id: 8,
    dimension: 'JP',
    text: '對待待辦事項，你比較像…',
    optionA: { label: '提早完成才安心', letter: 'J' },
    optionB: { label: '在截止前衝刺也 OK', letter: 'P' },
  },
  {
    id: 9,
    dimension: 'EI',
    text: '長時間社交後，你通常…',
    optionA: { label: '覺得精神更好、還想繼續', letter: 'E' },
    optionB: { label: '需要獨處一段時間才能恢復', letter: 'I' },
  },
  {
    id: 10,
    dimension: 'SN',
    text: '學新東西時，你偏好…',
    optionA: { label: '按步驟操作、先掌握基本功', letter: 'S' },
    optionB: { label: '先理解大方向，再補細節', letter: 'N' },
  },
]

const DIMENSION_PAIRS: Record<MbtiDimension, [MbtiLetter, MbtiLetter]> = {
  EI: ['E', 'I'],
  SN: ['S', 'N'],
  TF: ['T', 'F'],
  JP: ['J', 'P'],
}

export function computeMbtiType(
  answers: Record<number, MbtiChoice>,
  questions: MbtiQuestion[] = MBTI_QUESTIONS,
): MbtiType {
  const scores: Record<MbtiLetter, number> = {
    E: 0, I: 0, S: 0, N: 0, T: 0, F: 0, J: 0, P: 0,
  }

  for (const q of questions) {
    const choice = answers[q.id]
    if (choice === 'A') scores[q.optionA.letter] += 1
    else if (choice === 'B') scores[q.optionB.letter] += 1
  }

  let result = ''
  for (const dim of ['EI', 'SN', 'TF', 'JP'] as MbtiDimension[]) {
    const [left, right] = DIMENSION_PAIRS[dim]
    result += scores[left] >= scores[right] ? left : right
  }
  return result as MbtiType
}
