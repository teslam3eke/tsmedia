/** 證件姓名比對（verify-id）：支援員工證中英並列；扣繳／薪資以中文姓名為準。 */

export type VerificationDocTypeHint =
  | 'employee_id'
  | 'tax_return'
  | 'payslip'
  | 'bank_statement'
  | 'other'

export function normalizeNameForCompare(name: string | null | undefined): string {
  return (name ?? '')
    .normalize('NFKC')
    .replace(/[\s　·・．.。､,，、\-－_()（）[\]【】「」『』:：;；/\\|]/g, '')
    .toLowerCase()
}

/** 員工證常見「中文／English」— 先切段再各自正規化。 */
export function extractDetectedNameCandidates(detected: string | null | undefined): string[] {
  if (detected == null || detected.trim() === '') return []
  const trimmed = detected.trim()
  const pieces = trimmed.split(/[/／｜|\n\r]+/).map((s) => s.trim()).filter(Boolean)
  const rawPieces = pieces.length > 0 ? pieces : [trimmed]
  return [...new Set(rawPieces.map((s) => normalizeNameForCompare(s)).filter(Boolean))]
}

/** 從 OCR 結果擷取連續中文姓名片段（2–4 字，含罕用字區）。 */
export function extractChineseNameSegments(text: string | null | undefined): string[] {
  if (!text?.trim()) return []
  const runs = text.match(/[\u3400-\u9fff]{2,4}/g) ?? []
  return [...new Set(runs.map((s) => s.normalize('NFKC')).filter(Boolean))]
}

export function normalizeClaimedChineseName(name: string): string {
  return (name ?? '').normalize('NFKC').replace(/[^\u3400-\u9fff]/g, '')
}

function claimedMatchesChineseSegments(claimedName: string, detectedName: string | null | undefined): boolean {
  const claimedCjk = normalizeClaimedChineseName(claimedName)
  if (!claimedCjk) return false
  const segments = extractChineseNameSegments(detectedName)
  if (segments.length === 0) return false
  return segments.some((seg) => seg === claimedCjk || seg.includes(claimedCjk) || claimedCjk.includes(seg))
}

/** 扣繳／薪資：僅以中文姓名比對；不得用英文／羅馬拼音通過。 */
export function preferChineseOnlyNameMatch(docType?: VerificationDocTypeHint): boolean {
  return docType === 'tax_return' || docType === 'payslip'
}

export function claimedNameMatchesDetected(
  claimedName: string,
  detectedName: string | null | undefined,
  options?: { docType?: VerificationDocTypeHint },
): boolean {
  const claimed = normalizeNameForCompare(claimedName)
  if (!claimed) return false

  if (preferChineseOnlyNameMatch(options?.docType)) {
    if (claimedMatchesChineseSegments(claimedName, detectedName)) return true
    /** 模型若仍回「中文／英文」，只取中文段比對 */
    const cjkCandidates = extractDetectedNameCandidates(detectedName)
      .map((c) => normalizeClaimedChineseName(c))
      .filter(Boolean)
    if (cjkCandidates.some((c) => c === normalizeClaimedChineseName(claimedName))) return true
    return false
  }

  return extractDetectedNameCandidates(detectedName).some((c) => c === claimed)
}
