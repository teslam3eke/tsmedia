/** 管理後台：會員審核拒絕預設理由（會寫入 reviewer_note 並通知申請者） */

export type AdminVerificationRejectPreset = {
  id: string
  category: string
  label: string
  message: string
  /** 選「其他」時是否必須填補充說明 */
  requiresExtra?: boolean
}

export const ADMIN_VERIFICATION_REJECT_PRESETS: AdminVerificationRejectPreset[] = [
  {
    id: 'id_blurry',
    category: '證件／文件',
    label: '證件模糊不清',
    message:
      '您上傳的身分證件影像過於模糊，無法確認姓名與證件資訊。請在光線充足處重新拍攝後再送審。',
  },
  {
    id: 'name_mismatch',
    category: '證件／文件',
    label: '姓名與資料不符',
    message:
      '證件上的姓名與您填寫的個人資料不一致，請確認姓名拼寫後重新上傳正確證件。',
  },
  {
    id: 'id_incomplete',
    category: '證件／文件',
    label: '證件不完整',
    message:
      '證件四角未完整入鏡，或重要資訊被遮擋。請重新拍攝完整、清晰的證件照片。',
  },
  {
    id: 'id_expired',
    category: '證件／文件',
    label: '證件已過期',
    message: '您上傳的證件已過有效期限，請提供仍在有效期內的證件。',
  },
  {
    id: 'id_not_self',
    category: '證件／文件',
    label: '非本人證件',
    message: '無法確認證件與申請者為同一人，請重新上傳本人證件。',
  },
  {
    id: 'doc_type_wrong',
    category: '證件／文件',
    label: '文件類型不符',
    message:
      '上傳的文件不符合審核要求（例如需身分證／護照，或需扣繳憑單／薪資單等）。請依提示重新上傳正確類型。',
  },
  {
    id: 'employment_mismatch',
    category: '任職／加分',
    label: '任職證明無法核對',
    message:
      '任職證明上的公司或職稱與您填寫的資料不一致，或文件無法辨識。請修正個人資料或重新上傳可核對的證明。',
  },
  {
    id: 'employment_insufficient',
    category: '任職／加分',
    label: '任職證明不足',
    message:
      '目前文件無法證明您的任職資訊。請上傳員工識別證、在職證明或扣繳憑單等可佐證文件。',
  },
  {
    id: 'income_unverified',
    category: '任職／加分',
    label: '收入證明無法採信',
    message:
      '收入相關文件無法確認所申請的等級，請重新上傳清晰的扣繳憑單、薪資單或銀行對帳等文件。',
  },
  {
    id: 'photos_insufficient',
    category: '生活照／資料',
    label: '生活照不足',
    message:
      '生活照數量或清晰度未達平台標準。請補充至少一張清晰、可辨識本人的生活照後重新送審。',
  },
  {
    id: 'photos_not_self',
    category: '生活照／資料',
    label: '生活照非本人或過度修圖',
    message:
      '生活照無法清楚辨識為本人，或與證件／個人形象明顯不符。請上傳自然、清晰的本人照片。',
  },
  {
    id: 'bio_too_short',
    category: '生活照／資料',
    label: '自傳／問卷過於簡略',
    message:
      '自傳或問卷內容過於簡短，無法協助其他會員認識您。請充實自我介紹與問卷回答後重新送審。',
  },
  {
    id: 'profile_enrich',
    category: '生活照／資料',
    label: '建議充實加分項目',
    message:
      '目前資料尚不足以通過審核。建議您補充任職加分證明、更完整的自傳，或上傳更清晰的生活照後再次申請。',
  },
  {
    id: 'profile_overall',
    category: '生活照／資料',
    label: '整體資料待完善',
    message:
      '您的申請資料整體尚待完善。請依審核提示修正證件、生活照或個人簡介後重新送審；原有填寫內容已為您保留。',
  },
  {
    id: 'resubmit_unchanged',
    category: '其他',
    label: '重複或無效送審',
    message:
      '本次送審內容與先前相同，或未依上次退件原因修正。請依退件說明調整後再送審。',
  },
  {
    id: 'other',
    category: '其他',
    label: '其他（需補充說明）',
    message: '',
    requiresExtra: true,
  },
]

export function buildAdminVerificationRejectNote(
  presetId: string | null,
  extraNote: string,
): { ok: true; note: string } | { ok: false; error: string } {
  const extra = extraNote.trim()
  const preset = presetId ? ADMIN_VERIFICATION_REJECT_PRESETS.find((p) => p.id === presetId) : null

  if (!preset && !extra) {
    return { ok: false, error: '請選擇拒絕理由，或填寫補充說明。' }
  }

  if (preset?.requiresExtra && !extra) {
    return { ok: false, error: '選擇「其他」時請填寫補充說明。' }
  }

  if (preset?.requiresExtra) {
    return { ok: true, note: extra }
  }

  if (preset?.message && extra) {
    return { ok: true, note: `${preset.message}（補充：${extra}）` }
  }

  if (preset?.message) {
    return { ok: true, note: preset.message }
  }

  return { ok: true, note: extra }
}
