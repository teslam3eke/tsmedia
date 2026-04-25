// ─── Supabase Database Types ────────────────────────────────────────────────

export type Company = 'TSMC' | 'MediaTek'
export type VerificationStatus = 'pending' | 'submitted' | 'approved' | 'rejected'
export type DocType = 'employee_id' | 'tax_return' | 'payslip' | 'bank_statement' | 'other'
export type DocStatus = 'pending' | 'approved' | 'rejected'

export type IncomeTier = 'silver' | 'gold' | 'diamond'
export type VerificationKind = 'employment' | 'income'

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
    }
  }
}
