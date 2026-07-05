import { mbtiChallengeCompatScore, mbtiGoldenCompatScore } from '@/lib/mbtiCompat'

/** 天選：至少幾項興趣相同才有資格（門檻） */
export const FATED_HEAVEN_MIN_INTEREST_OVERLAP = 1

/** 地選：興趣必須完全無交集 */
export const FATED_EARTH_INTEREST_OVERLAP = 0

export function interestOverlap(a: readonly string[], b: readonly string[]): number {
  const setB = new Set(b)
  let n = 0
  for (const x of a) if (setB.has(x)) n += 1
  return n
}

export function heavenInterestEligible(overlapCount: number): boolean {
  return overlapCount >= FATED_HEAVEN_MIN_INTEREST_OVERLAP
}

export function earthInterestEligible(overlapCount: number): boolean {
  return overlapCount === FATED_EARTH_INTEREST_OVERLAP
}

/** 天選候選排序：Golden 分優先，同分再比興趣重疊數 */
export function compareHeavenCandidates(
  a: { goldenScore: number; interestOverlap: number },
  b: { goldenScore: number; interestOverlap: number },
): number {
  if (b.goldenScore !== a.goldenScore) return b.goldenScore - a.goldenScore
  return b.interestOverlap - a.interestOverlap
}

/** 地選候選排序：Challenge 分優先 */
export function compareEarthCandidates(
  a: { challengeScore: number },
  b: { challengeScore: number },
): number {
  return b.challengeScore - a.challengeScore
}

export function heavenPairScores(mbtiA: string | null | undefined, mbtiB: string | null | undefined, itemsA: readonly string[], itemsB: readonly string[]) {
  const ov = interestOverlap(itemsA, itemsB)
  return {
    interestOverlap: ov,
    goldenScore: mbtiGoldenCompatScore(mbtiA, mbtiB),
    eligible: heavenInterestEligible(ov) && mbtiGoldenCompatScore(mbtiA, mbtiB) > 0,
  }
}

export function earthPairScores(mbtiA: string | null | undefined, mbtiB: string | null | undefined, itemsA: readonly string[], itemsB: readonly string[]) {
  const ov = interestOverlap(itemsA, itemsB)
  return {
    interestOverlap: ov,
    challengeScore: mbtiChallengeCompatScore(mbtiA, mbtiB),
    eligible: earthInterestEligible(ov) && mbtiChallengeCompatScore(mbtiA, mbtiB) > 0,
  }
}
