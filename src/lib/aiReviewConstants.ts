/**
 * AI 自動審核：寫入 verification_docs.ai_review_ready_at 的延遲（秒）。
 * 請與 submitVerificationDoc / submitIncomeVerification（db.ts）維持一致。
 */
export const AI_AUTO_REVIEW_UI_SECONDS = 5

/** 編輯頁收入認證等待 overlay 最長秒數；後端提早核准則立即關閉 overlay */
export const INCOME_WAIT_OVERLAY_MAX_SECONDS = 60
