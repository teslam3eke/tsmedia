import { sanitizeVerificationUserMessage } from './companyDisplay'

export const VERIFICATION_MANUAL_REVIEW_TAIL = '人工審核時間可能大於 12 小時。'

export const VERIFICATION_AI_USER_UNAVAILABLE =
  `AI 暫時無法完成審核，已轉人工審核。${VERIFICATION_MANUAL_REVIEW_TAIL}`

export const VERIFICATION_AI_INCOME_USER_UNAVAILABLE =
  `AI 暫時無法完成收入審核，已轉人工審核。${VERIFICATION_MANUAL_REVIEW_TAIL}`

export function summarizeVerificationApiError(err: unknown): string {
  if (err instanceof DOMException && err.name === 'AbortError') {
    return '請求逾時'
  }
  if (err instanceof TypeError) {
    const msg = err.message.trim()
    if (/fetch|network|failed to fetch|load failed/i.test(msg)) {
      return '網路連線失敗'
    }
    if (msg) return msg.slice(0, 160)
  }
  if (err instanceof Error && err.message.trim()) {
    return err.message.trim().slice(0, 160)
  }
  const text = String(err).trim()
  return text ? text.slice(0, 160) : '未知錯誤'
}

/** 寫入 verification_docs.ai_reason／manual_review_reason，供後台看具體失敗原因 */
export function buildVerificationApiFailureReason(err: unknown): string {
  return `[審核 API 失敗：${summarizeVerificationApiError(err)}] 已轉人工審核。`
}

export function buildVerificationHttpFailureReason(
  response: Response,
  bodyMessage?: string | null,
): string {
  const detail = bodyMessage?.trim()
    ? sanitizeVerificationUserMessage(bodyMessage)
    : ''
  return `[審核 API 失敗：HTTP ${response.status}${detail ? `，${detail}` : ''}] 已轉人工審核。`
}

export function buildVerificationJsonParseFailureReason(response: Response, rawSnippet: string): string {
  const snippet = rawSnippet.slice(0, 80).replace(/\s+/g, ' ').trim()
  return `[審核 API 失敗：HTTP ${response.status}，回應非 JSON${snippet ? `（${snippet}…）` : ''}] 已轉人工審核。`
}

export function resolveManualReviewReason(
  aiReason: string | null | undefined,
  fallback = `AI 未通過，已轉人工審核。${VERIFICATION_MANUAL_REVIEW_TAIL}`,
): string {
  const trimmed = aiReason?.trim()
  if (trimmed) return trimmed
  return fallback
}

export type VerifyIdResponseBody = {
  ok: boolean
  company?: string | null
  confidence?: string | null
  suggestedIncomeTier?: string | null
  message?: string
  reason?: string | null
}

export async function parseVerifyIdResponse(response: Response): Promise<{
  data: VerifyIdResponseBody | null
  failureReason: string | null
}> {
  let raw = ''
  try {
    raw = await response.text()
  } catch (err) {
    return {
      data: null,
      failureReason: buildVerificationApiFailureReason(err),
    }
  }

  if (!raw.trim()) {
    return {
      data: null,
      failureReason: buildVerificationHttpFailureReason(response),
    }
  }

  let parsed: VerifyIdResponseBody
  try {
    parsed = JSON.parse(raw) as VerifyIdResponseBody
  } catch {
    return {
      data: null,
      failureReason: buildVerificationJsonParseFailureReason(response, raw),
    }
  }

  if (!response.ok) {
    const msg = parsed.message ?? parsed.reason ?? null
    return {
      data: parsed,
      failureReason: buildVerificationHttpFailureReason(response, msg),
    }
  }

  return { data: parsed, failureReason: null }
}

export function verifyIdReasonFromBody(data: VerifyIdResponseBody): string {
  return sanitizeVerificationUserMessage(
    data.reason ?? data.message ?? `AI 未通過，已轉人工審核。${VERIFICATION_MANUAL_REVIEW_TAIL}`,
  )
}
