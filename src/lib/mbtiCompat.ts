import { isValidMbtiType, type MbtiType } from '@/lib/mbti'

/** 黃金配對（排名 1 最經典；雙向對稱） */
export const MBTI_GOLDEN_PAIRS: ReadonlyArray<readonly [MbtiType, MbtiType, number]> = [
  ['INFJ', 'ENFP', 1],
  ['INFP', 'ENFJ', 2],
  ['INTP', 'ENTJ', 3],
  ['INTJ', 'ENFP', 4],
  ['ENTP', 'INFJ', 5],
  ['ISFJ', 'ESTP', 6],
  ['ISTJ', 'ESFP', 7],
  ['ISTP', 'ESTJ', 8],
  ['ISFP', 'ESFJ', 9],
  ['ENTP', 'INTJ', 10],
] as const

/** 最容易遇到挑戰的組合（排名 1 差異最大；雙向對稱；表內去重） */
export const MBTI_CHALLENGE_PAIRS: ReadonlyArray<readonly [MbtiType, MbtiType, number]> = [
  ['INTJ', 'ESFP', 1],
  ['INTP', 'ESFJ', 2],
  ['ESTJ', 'INFP', 3],
  ['ISTJ', 'ENFP', 4],
  ['INFJ', 'ESTP', 5],
  ['ISFP', 'ENTJ', 6],
  ['ENFJ', 'ISTP', 7],
  ['ESTP', 'INFP', 9],
] as const

function pairKey(a: string, b: string): string {
  return [a, b].sort().join('|')
}

function buildRankScoreMap(pairs: ReadonlyArray<readonly [MbtiType, MbtiType, number]>) {
  const map = new Map<string, number>()
  for (const [x, y, rank] of pairs) {
    map.set(pairKey(x, y), 11 - rank)
  }
  return map
}

const goldenScoreByPair = buildRankScoreMap(MBTI_GOLDEN_PAIRS)
const challengeScoreByPair = buildRankScoreMap(MBTI_CHALLENGE_PAIRS)

export function mbtiGoldenCompatScore(a: string | null | undefined, b: string | null | undefined): number {
  if (!isValidMbtiType(a) || !isValidMbtiType(b)) return 0
  return goldenScoreByPair.get(pairKey(a, b)) ?? 0
}

export function mbtiChallengeCompatScore(a: string | null | undefined, b: string | null | undefined): number {
  if (!isValidMbtiType(a) || !isValidMbtiType(b)) return 0
  return challengeScoreByPair.get(pairKey(a, b)) ?? 0
}

export function isMbtiGoldenPair(a: string | null | undefined, b: string | null | undefined): boolean {
  return mbtiGoldenCompatScore(a, b) > 0
}

export function isMbtiChallengePair(a: string | null | undefined, b: string | null | undefined): boolean {
  return mbtiChallengeCompatScore(a, b) > 0
}

/** 某類型在 Golden 表上的最佳搭檔（可能有多個同分） */
export function goldenPartnersFor(type: MbtiType): Array<{ type: MbtiType; rank: number; score: number }> {
  const out: Array<{ type: MbtiType; rank: number; score: number }> = []
  for (const [x, y, rank] of MBTI_GOLDEN_PAIRS) {
    if (x === type) out.push({ type: y, rank, score: 11 - rank })
    else if (y === type) out.push({ type: x, rank, score: 11 - rank })
  }
  return out.sort((a, b) => a.rank - b.rank)
}

export function challengePartnersFor(type: MbtiType): Array<{ type: MbtiType; rank: number; score: number }> {
  const out: Array<{ type: MbtiType; rank: number; score: number }> = []
  for (const [x, y, rank] of MBTI_CHALLENGE_PAIRS) {
    if (x === type) out.push({ type: y, rank, score: 11 - rank })
    else if (y === type) out.push({ type: x, rank, score: 11 - rank })
  }
  return out.sort((a, b) => a.rank - b.rank)
}

/** UI 參考星等（5 星 = 表上前段） */
export function goldenStars(score: number): number {
  if (score >= 9) return 5
  if (score >= 7) return 4
  return 0
}

export function challengeStars(score: number): number {
  if (score >= 9) return 5
  if (score >= 7) return 4
  return 0
}
