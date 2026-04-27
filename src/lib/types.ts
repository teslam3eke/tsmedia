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

export const INCOME_TIER_META: Record<IncomeTier, { label: string; range: string; short: string }> = {
  silver:  { label: '銀級認證',   range: '年收 200–299 萬', short: '銀框' },
  gold:    { label: '金級認證',   range: '年收 300–399 萬', short: '金框' },
  diamond: { label: '鑽石級認證', range: '年收 400 萬以上', short: '鑽石框' },
}

export type Region = 'north' | 'central' | 'south' | 'east'
export const REGION_LABELS: Record<Region, string> = {
  north:   '北部',
  central: '中部',
  south:   '南部',
  east:    '東部',
}

export interface QuestionnaireEntry {
  id: number
  category: string
  text: string
  answer: string
}

export interface ProfileRow {
  id: string                          // uuid — matches auth.users.id
  name: string | null
  gender: 'male' | 'female' | null
  age: number | null
  company: Company | null
  job_title: string | null
  department: string | null
  bio: string | null
  interests: string[] | null
  questionnaire: QuestionnaireEntry[] | null  // 10 questions + answers (jsonb)
  photo_urls: string[] | null                  // life photos in Storage
  work_region: Region | null                   // 工作地點
  home_region: Region | null                   // 戶籍地
  preferred_region: Region | null              // 配對期望對方所在地（對方 work 或 home 任一符合即可）
  is_verified: boolean
  verification_status: VerificationStatus
  income_tier: IncomeTier | null               // 審核通過的收入等級（null = 未認證）
  show_income_border: boolean                  // 使用者開關：是否對外顯示收入邊框
  is_admin: boolean                            // 管理員帳號
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
    }
  }
}
