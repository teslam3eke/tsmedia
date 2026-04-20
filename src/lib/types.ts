// ─── Supabase Database Types ────────────────────────────────────────────────

export type Company = 'TSMC' | 'MediaTek'
export type VerificationStatus = 'pending' | 'submitted' | 'approved' | 'rejected'
export type DocType = 'employee_id' | 'tax_return' | 'payslip'
export type DocStatus = 'pending' | 'approved' | 'rejected'

export interface QuestionnaireEntry {
  id: number
  category: string
  text: string
  answer: string
}

export interface ProfileRow {
  id: string                          // uuid — matches auth.users.id
  name: string | null
  age: number | null
  company: Company | null
  job_title: string | null
  department: string | null
  bio: string | null
  interests: string[] | null
  questionnaire: QuestionnaireEntry[] | null  // 10 questions + answers (jsonb)
  photo_urls: string[] | null                  // life photos in Storage
  is_verified: boolean
  verification_status: VerificationStatus
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
