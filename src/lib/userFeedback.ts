export type UserFeedbackCategory =
  | 'bug'
  | 'account'
  | 'payment'
  | 'discover'
  | 'instant_match'
  | 'verify'
  | 'safety'
  | 'suggestion'
  | 'other'

export const USER_FEEDBACK_CATEGORIES: {
  value: UserFeedbackCategory
  label: string
  desc: string
}[] = [
  { value: 'bug', label: '功能異常', desc: 'App 閃退、無法載入、按鈕無反應等' },
  { value: 'account', label: '帳號登入', desc: '登入、註冊、個人資料或通知相關' },
  { value: 'payment', label: '付費／會員', desc: '訂閱、付款、愛心或道具購買' },
  { value: 'discover', label: '探索／配對', desc: '每日探索、配對聊天或拼圖解鎖' },
  { value: 'instant_match', label: '即時七分鐘', desc: '排隊、撮合或即時聊天' },
  { value: 'verify', label: '認證審核', desc: '公司或收入認證流程' },
  { value: 'safety', label: '安全／檢舉', desc: '騷擾、詐騙或平台安全相關' },
  { value: 'suggestion', label: '功能建議', desc: '希望新增或改善的功能' },
  { value: 'other', label: '其他', desc: '以上皆不符合時請選此項' },
]

export function userFeedbackCategoryLabel(category: string): string {
  return USER_FEEDBACK_CATEGORIES.find((item) => item.value === category)?.label ?? category
}
