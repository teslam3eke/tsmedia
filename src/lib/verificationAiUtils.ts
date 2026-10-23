import { sanitizeVerificationUserMessage } from './companyDisplay'

export const VERIFICATION_MANUAL_REVIEW_TAIL = '人工審核時間可能大於 12 小時。'

/** 前端顯示：轉人工審核時不揭露具體原因（後台仍保留 ai_reason／manual_review_reason） */
export const VERIFICATION_MANUAL_REVIEW_USER_MESSAGE =
  `已轉人工審核。${VERIFICATION_MANUAL_REVIEW_TAIL}`

/** 前端顯示：AI 初審未通過且仍可重試（第 1–4 次） */
export const VERIFICATION_AI_PREFLIGHT_FAIL_USER_MESSAGE =
  'AI審核未通過請確認公司名稱及姓名是否清楚。'

export const VERIFICATION_AI_USER_UNAVAILABLE = VERIFICATION_MANUAL_REVIEW_USER_MESSAGE

export const VERIFICATION_AI_INCOME_USER_UNAVAILABLE = VERIFICATION_MANUAL_REVIEW_USER_MESSAGE

/** 職業／收入認證各自每日送審上限（onboarding 與站內一致） */
export const VERIFICATION_DAILY_SUBMIT_LIMIT = 5

/** onboarding 前景：`/api/verify-id` 最長等待（站內 MainScreen 仍為 5 分鐘） */
export const VERIFY_ID_FETCH_TIMEOUT_MS = 2 * 60 * 1000

/** onboarding 送審 overlay：API／整段逾時 */
export const VERIFICATION_SUBMIT_TIMEOUT_USER_MESSAGE =
  '送審逾時，請檢查網路後再試一次。'

/** onboarding 送審 overlay：背景過久或連線中斷 */
export const VERIFICATION_SUBMIT_INTERRUPT_USER_MESSAGE =
  '送審已中斷（可能因切換 App 或連線中斷），請重新按「下一步」再送一次。'

export async function postVerifyId(
  body: Record<string, unknown>,
  opts?: { signal?: AbortSignal },
): Promise<Response> {
  const timeoutCtrl = new AbortController()
  const timeoutId = globalThis.setTimeout(() => timeoutCtrl.abort(), VERIFY_ID_FETCH_TIMEOUT_MS)

  let onParentAbort: (() => void) | undefined
  if (opts?.signal) {
    if (opts.signal.aborted) timeoutCtrl.abort()
    else {
      onParentAbort = () => timeoutCtrl.abort()
      opts.signal.addEventListener('abort', onParentAbort, { once: true })
    }
  }

  try {
    return await fetch('/api/verify-id', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: timeoutCtrl.signal,
    })
  } finally {
    globalThis.clearTimeout(timeoutId)
    if (opts?.signal && onParentAbort) {
      opts.signal.removeEventListener('abort', onParentAbort)
    }
  }
}

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

/** 整包人工審核退件：站內彈窗／推播／重新送審畫面共用文案 */
export const VERIFICATION_APPLICATION_REJECTION_FOOTER =
  '你的個人資料與生活照已保留，請修正證件後重新送審。'

/** 與 api/_utils/verificationRejectPresetMessages 對齊（僅使用者可見文案） */
const AUTO_TEXT_REJECT_PREFIX = 'AUTO_TEXT_REJECT:'
const AUTO_TEXT_REJECT_USER_MESSAGES: Record<string, string> = {
  bio_too_short:
    '自傳或問卷內容過於簡短，無法協助其他會員認識您。請充實自我介紹與問卷回答後重新送審。',
  text_repeat_stuffing:
    '自傳或問卷有過多重複的字、數字或符號（如連續「～」「！」、同一字或數字重複多次）。請改寫成正常句子後再送審。',
  text_off_platform:
    '自傳或問卷不可留 IG、LINE、電話、Email、網址等站外聯絡或導流。請刪除後再送審。',
  photos_insufficient:
    '生活照數量或清晰度未達平台標準。請補充至少一張清晰、可辨識本人的生活照後重新送審。',
  fit_age_group:
    '依您目前的年齡與配對條件，平台現階段可提供的合適對象較少。為避免開通後配對體驗不如預期，本次暫不開放會員資格。',
}

function userFacingRejectReasonFromReviewerNote(reviewerNote: string | null | undefined): string | null {
  const trimmed = reviewerNote?.trim() ?? ''
  if (trimmed.startsWith(AUTO_TEXT_REJECT_PREFIX)) {
    const id = trimmed.slice(AUTO_TEXT_REJECT_PREFIX.length).split(/[\s|]/)[0]?.trim()
    if (id && id in AUTO_TEXT_REJECT_USER_MESSAGES) return AUTO_TEXT_REJECT_USER_MESSAGES[id]
  }
  return trimmed || null
}

function displayRejectReason(raw: string): string {
  const fromNote = userFacingRejectReasonFromReviewerNote(raw)
  const text = fromNote ?? raw
  return sanitizeVerificationUserMessage(text)
}

export function formatVerificationApplicationRejectionAlertBody(
  reviewerNote?: string | null,
): string {
  const reason = reviewerNote?.trim() ? displayRejectReason(reviewerNote.trim()) : null
  if (reason) return `退件原因：${reason}。${VERIFICATION_APPLICATION_REJECTION_FOOTER}`
  return `審核未通過。${VERIFICATION_APPLICATION_REJECTION_FOOTER}`
}

/** 從通知正文取出退件原因（相容舊版「原因：」前綴）。 */
export function parseVerificationRejectionReasonFromBody(body: string): string | null {
  const modern = body.match(/^退件原因：(.+?)。/)
  if (modern?.[1]?.trim()) return displayRejectReason(modern[1].trim())
  const legacy = body.match(/^原因：(.+?)。/)
  if (legacy?.[1]?.trim()) return displayRejectReason(legacy[1].trim())
  return null
}
