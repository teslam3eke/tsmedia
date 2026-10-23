/**
 * AI 自動審核：寫入 verification_docs.ai_review_ready_at 的延遲（秒）。
 * 請與 submitVerificationDoc / submitIncomeVerification（db.ts）維持一致。
 */
export const AI_AUTO_REVIEW_UI_SECONDS = 5

/** 編輯頁收入認證等待 overlay 最長秒數；後端提早核准則立即關閉 overlay */
export const INCOME_WAIT_OVERLAY_MAX_SECONDS = 60

/**
 * Onboarding 送審：自傳／問卷後台文字審 + 自動通過的等待體驗（非 OpenAI 生活照）。
 * - 畫面至少顯示 MIN 秒（即使後端已先完成，也不可早於此時間揭曉結果）。
 * - TARGET 為產品目標體感（文案／進度約此秒數）；後端若超過 TARGET 則等真實完成再揭曉。
 */
export const VERIFICATION_ONBOARDING_REVIEW_MIN_SECONDS = 15
export const VERIFICATION_ONBOARDING_REVIEW_TARGET_SECONDS = 30
