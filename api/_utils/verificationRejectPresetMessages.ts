/** API 用：與 src/lib/adminVerificationRejectReasons 使用者訊息對齊（避免 API 依賴 src） */

export const AUTO_TEXT_REJECT_NOTE_PREFIX = 'AUTO_TEXT_REJECT:'

export type AutoTextRejectPresetId =
  | 'bio_too_short'
  | 'text_repeat_stuffing'
  | 'text_off_platform'
  | 'photos_insufficient'
  | 'fit_age_group'

const PRESET_MESSAGES: Record<AutoTextRejectPresetId, string> = {
  bio_too_short:
    '自傳或問卷內容過於簡短，無法協助其他會員認識您。請充實自我介紹與問卷回答後重新送審。',
  text_repeat_stuffing:
    '自傳或問卷有過多重複的字或符號（如連續「～」「！」、同一字重複多次）。請改寫成正常句子後再送審。',
  text_off_platform:
    '自傳或問卷不可留 IG、LINE、電話、Email、網址等站外聯絡或導流。請刪除後再送審。',
  photos_insufficient:
    '生活照數量或清晰度未達平台標準。請補充至少一張清晰、可辨識本人的生活照後重新送審。',
  fit_age_group:
    '依您目前的年齡與配對條件，平台現階段可提供的合適對象較少。為避免開通後配對體驗不如預期，本次暫不開放會員資格。',
}

export function messageForAutoTextRejectPreset(presetId: AutoTextRejectPresetId): string {
  return PRESET_MESSAGES[presetId]
}

export function buildAutoTextRejectReviewerNote(presetId: AutoTextRejectPresetId): string {
  return `${AUTO_TEXT_REJECT_NOTE_PREFIX}${presetId}`
}

export function parseAutoTextRejectPresetId(reviewerNote: string | null | undefined): AutoTextRejectPresetId | null {
  const note = reviewerNote?.trim() ?? ''
  if (!note.startsWith(AUTO_TEXT_REJECT_NOTE_PREFIX)) return null
  const id = note.slice(AUTO_TEXT_REJECT_NOTE_PREFIX.length).split(/[\s|]/)[0]?.trim()
  if (id && id in PRESET_MESSAGES) return id as AutoTextRejectPresetId
  return null
}

export function userMessageFromAutoRejectNote(reviewerNote: string | null | undefined): string | null {
  const presetId = parseAutoTextRejectPresetId(reviewerNote)
  if (!presetId) return null
  return messageForAutoTextRejectPreset(presetId)
}
