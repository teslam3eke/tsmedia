// ─── Supabase Database Types ────────────────────────────────────────────────

export type Company = 'TSMC' | 'MediaTek'
export type VerificationStatus = 'pending' | 'submitted' | 'approved' | 'rejected'
export type DocType = 'employee_id' | 'tax_return' | 'payslip' | 'bank_statement' | 'other'
export type DocStatus = 'pending' | 'approved' | 'rejected'
export type AiConfidence = 'high' | 'medium' | 'low'

export type IncomeTier = 'silver' | 'gold' | 'diamond'
export type VerificationKind = 'employment' | 'income'
export type AppNotificationKind = 'verification_approved' | 'verification_rejected' | 'super_like_received' | 'match_created' | 'message_received'
export type ReviewMode = 'manual' | 'ai_auto'
export type ProfileInteractionAction = 'pass' | 'like' | 'super_like'
export type ReportReason = 'fake_profile' | 'married_or_not_single' | 'harassment' | 'scam_or_sales' | 'inappropriate_content' | 'privacy_violation' | 'other'
export type MessageReportReason = 'harassment' | 'scam_or_sales' | 'inappropriate_content' | 'privacy_violation' | 'other'
export type CreditType = 'heart' | 'super_like' | 'blur_unlock' | 'point'
export type CreditTransactionKind = 'purchase' | 'spend' | 'refund' | 'admin_adjust'

export const INCOME_TIER_META: Record<IncomeTier, { label: string; range: string; short: string }> = {
  silver:  { label: '銀皇冠認證',   range: '200萬+', short: '銀皇冠' },
  gold:    { label: '金皇冠認證',   range: '300萬+', short: '金皇冠' },
  diamond: { label: '鑽石皇冠認證', range: '400萬+', short: '鑽石皇冠' },
}

export type Region = 'north' | 'central' | 'south' | 'east'
export const REGION_LABELS: Record<Region, string> = {
  north:   '北部',
  central: '中部',
  south:   '南部',
  east:    '東部',
}

/** 個人檔案生活照張數（探索／編輯頁一致） */
export const PROFILE_PHOTO_MIN = 1
export const PROFILE_PHOTO_MAX = 3

export interface QuestionnaireEntry {
  id: number
  category: string
  text: string
  answer: string
}

export interface ProfileRow {
  id: string                          // uuid — matches auth.users.id
  name: string | null
  nickname: string | null
  gender: 'male' | 'female' | null
  age: number | null
  company: Company | null
  job_title: string | null
  department: string | null
  bio: string | null
  interests: string[] | null
  questionnaire: QuestionnaireEntry[] | null  // 10 questions + answers (jsonb)
  photo_urls: string[] | null                  // 生活照 Storage 路徑，1–3 張
  work_region: Region | null                   // 工作地點
  home_region: Region | null                   // 戶籍地
  preferred_region: Region | null              // 配對期望對方所在地（對方 work 或 home 任一符合即可）
  is_verified: boolean
  verification_status: VerificationStatus
  income_tier: IncomeTier | null               // 審核通過的收入等級（null = 未認證）
  show_income_border: boolean                  // 使用者開關：是否對外顯示收入皇冠
  is_admin: boolean                            // 管理員帳號
  /** 創始會員序號（1–999）；一般用戶為 null */
  founding_member_no?: number | null
  account_status: 'active' | 'suspended' | 'banned'
  terms_version: string | null                  // 最近同意的服務條款版本
  terms_accepted_at: string | null              // 最近同意時間
  subscription_expires_at?: string | null
  membership_welcome_granted_at?: string | null
  /** 登入統計（與 app 換日一致，由 RPC 維護） */
  login_last_app_day?: string | null
  login_streak?: number | null
  login_total_days?: number | null
  created_at: string
  updated_at: string
}

export interface VerificationDocRow {
  id: string
  user_id: string
  company: Company | null
  doc_type: DocType | null
  doc_url: string | null              // Supabase Storage path
  status: DocStatus
  verification_kind: VerificationKind
  claimed_income_tier: IncomeTier | null  // only meaningful when verification_kind='income'
  submitted_at: string
  reviewed_at: string | null
  reviewer_note: string | null
  // AI 初審結果
  ai_passed: boolean | null
  ai_company: Company | null
  ai_confidence: AiConfidence | null
  ai_reason: string | null
  review_mode: ReviewMode | null
  ai_review_ready_at: string | null
  manual_review_reason: string | null
}

// Admin 查詢時 join profiles 的結構
export interface VerificationDocWithProfile extends VerificationDocRow {
  profiles: {
    name: string | null
    gender: 'male' | 'female' | null
    photo_urls: string[] | null
  } | null
}

export interface AppNotificationRow {
  id: string
  user_id: string
  kind: AppNotificationKind
  title: string
  body: string
  read_at: string | null
  created_at: string
}

export interface ProfileInteractionRow {
  id: string
  actor_user_id: string
  target_user_id: string | null
  target_profile_key: string
  action: ProfileInteractionAction
  created_at: string
}

export interface MatchRow {
  id: string
  user_a: string
  user_b: string
  created_at: string
}

export interface MessageRow {
  id: string
  match_id: string
  sender_id: string
  body: string
  read_at: string | null
  created_at: string
}

export interface PhotoUnlockStateRow {
  match_id: string
  total_tiles: number
  unlocked_tiles: number[]
  updated_at: string
  created_at: string
}

export interface ProfileReportRow {
  id: string
  reporter_user_id: string
  reported_user_id: string | null
  reported_profile_key: string
  reported_display_name: string | null
  reason: ReportReason
  details: string | null
  status: 'open' | 'reviewing' | 'resolved' | 'dismissed'
  created_at: string
  reviewed_at: string | null
  reviewer_note: string | null
}

export interface ProfileBlockRow {
  id: string
  blocker_user_id: string
  blocked_user_id: string | null
  blocked_profile_key: string
  blocked_display_name: string | null
  reason: string | null
  created_at: string
}

export interface MessageReportRow {
  id: string
  reporter_user_id: string
  reported_user_id: string | null
  match_id: string | null
  message_id: string | null
  reported_profile_key: string | null
  reported_display_name: string | null
  message_body: string | null
  reason: MessageReportReason
  details: string | null
  status: 'open' | 'reviewing' | 'resolved' | 'dismissed'
  created_at: string
  reviewed_at: string | null
  reviewer_note: string | null
}

export interface CreditTransactionRow {
  id: string
  user_id: string
  kind: CreditTransactionKind
  credit_type: CreditType
  amount: number
  balance_after: number | null
  description: string | null
  related_user_id: string | null
  related_ref: string | null
  created_at: string
}

export type CreditBalance = Record<CreditType, number>

// ─── Supabase generated Database interface ──────────────────────────────────

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: ProfileRow
        Insert: Partial<ProfileRow> & { id: string }
        Update: Partial<ProfileRow>
      }
      verification_docs: {
        Row: VerificationDocRow
        Insert: Partial<VerificationDocRow> & { user_id: string }
        Update: Partial<VerificationDocRow>
      }
      app_notifications: {
        Row: AppNotificationRow
        Insert: Partial<AppNotificationRow> & { user_id: string; kind: AppNotificationKind; title: string; body: string }
        Update: Partial<AppNotificationRow>
      }
      profile_interactions: {
        Row: ProfileInteractionRow
        Insert: Partial<ProfileInteractionRow> & { actor_user_id: string; target_profile_key: string; action: ProfileInteractionAction }
        Update: Partial<ProfileInteractionRow>
      }
      matches: {
        Row: MatchRow
        Insert: Partial<MatchRow> & { user_a: string; user_b: string }
        Update: Partial<MatchRow>
      }
      messages: {
        Row: MessageRow
        Insert: Partial<MessageRow> & { match_id: string; sender_id: string; body: string }
        Update: Partial<MessageRow>
      }
      photo_unlock_states: {
        Row: PhotoUnlockStateRow
        Insert: Partial<PhotoUnlockStateRow> & { match_id: string }
        Update: Partial<PhotoUnlockStateRow>
      }
      profile_reports: {
        Row: ProfileReportRow
        Insert: Partial<ProfileReportRow> & { reporter_user_id: string; reported_profile_key: string; reason: ReportReason }
        Update: Partial<ProfileReportRow>
      }
      profile_blocks: {
        Row: ProfileBlockRow
        Insert: Partial<ProfileBlockRow> & { blocker_user_id: string; blocked_profile_key: string }
        Update: Partial<ProfileBlockRow>
      }
      message_reports: {
        Row: MessageReportRow
        Insert: Partial<MessageReportRow> & { reporter_user_id: string; reason: MessageReportReason }
        Update: Partial<MessageReportRow>
      }
      credit_transactions: {
        Row: CreditTransactionRow
        Insert: Partial<CreditTransactionRow> & { user_id: string; kind: CreditTransactionKind; credit_type: CreditType; amount: number }
        Update: Partial<CreditTransactionRow>
      }
    }
  }
}
