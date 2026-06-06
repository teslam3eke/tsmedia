export type TopTierCompany = 'TSMC' | 'MediaTek'

export function normalizeEmployerText(value: string | null | undefined): string {
  return (value ?? '')
    .normalize('NFKC')
    .replace(/[\s　·・．.。､,，、\-－_()（）[\]【】「」『』:：;；/\\|]/g, '')
    .toLowerCase()
}

export function detectTopTierCompanyFromText(text: string | null | undefined): TopTierCompany | null {
  const employer = normalizeEmployerText(text)
  if (!employer) return null
  if (employer.includes('聯發科') || employer.includes('mediatek') || employer.includes('mtk')) {
    return 'MediaTek'
  }
  if (employer.includes('台積電') || employer.includes('台灣積體電路') || employer.includes('tsmc')) {
    return 'TSMC'
  }
  return null
}

export function employerTextMatchesTopTier(text: string | null | undefined): boolean {
  return detectTopTierCompanyFromText(text) !== null
}

export function resolveTopTierCompanyFromFields(fields: {
  company?: TopTierCompany | null
  detectedEmployer?: string | null
  employerEvidenceQuote?: string | null
}): TopTierCompany | null {
  if (fields.company === 'TSMC' || fields.company === 'MediaTek') return fields.company
  return detectTopTierCompanyFromText(fields.detectedEmployer)
    ?? detectTopTierCompanyFromText(fields.employerEvidenceQuote)
}

export function hasTopTierEmployerEvidence(fields: {
  company?: TopTierCompany | null
  detectedEmployer?: string | null
  employerEvidenceQuote?: string | null
}): boolean {
  return resolveTopTierCompanyFromFields(fields) !== null
}
