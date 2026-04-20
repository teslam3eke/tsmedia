import { supabase } from './supabase'
import type { QuestionnaireEntry, Company, DocType, ProfileRow } from './types'

// ─── Profiles ────────────────────────────────────────────────────────────────

export async function getProfile(userId: string): Promise<ProfileRow | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single()

  if (error) {
    console.error('[db] getProfile error:', error.message)
    return null
  }
  return data
}

export interface UpsertProfilePayload {
  userId: string
  name?: string
  age?: number
  company?: Company
  jobTitle?: string
  department?: string
  bio?: string
  interests?: string[]
  questionnaire?: QuestionnaireEntry[]
  photoUrls?: string[]
}

export async function upsertProfile(payload: UpsertProfilePayload): Promise<{ ok: boolean; error?: string }> {
  const { userId, jobTitle, photoUrls, ...rest } = payload

  const { error } = await supabase
    .from('profiles')
    .upsert({
      id: userId,
      job_title: jobTitle,
      photo_urls: photoUrls,
      ...rest,
    })

  if (error) {
    console.error('[db] upsertProfile error:', error.message)
    return { ok: false, error: error.message }
  }
  return { ok: true }
}

export async function saveQuestionnaire(
  userId: string,
  entries: QuestionnaireEntry[],
): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase
    .from('profiles')
    .update({ questionnaire: entries })
    .eq('id', userId)

  if (error) {
    console.error('[db] saveQuestionnaire error:', error.message)
    return { ok: false, error: error.message }
  }
  return { ok: true }
}

// ─── Storage ─────────────────────────────────────────────────────────────────

export async function uploadPhoto(
  userId: string,
  file: File,
): Promise<{ ok: true; path: string } | { ok: false; error: string }> {
  const ext = file.name.split('.').pop() ?? 'jpg'
  const path = `${userId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`

  const { error } = await supabase.storage
    .from('photos')
    .upload(path, file, { upsert: false })

  if (error) {
    console.error('[db] uploadPhoto error:', error.message)
    return { ok: false, error: error.message }
  }
  return { ok: true, path }
}

export async function uploadProofDoc(
  userId: string,
  file: File,
): Promise<{ ok: true; path: string } | { ok: false; error: string }> {
  const ext = file.name.split('.').pop() ?? 'jpg'
  const path = `${userId}/${Date.now()}.${ext}`

  const { error } = await supabase.storage
    .from('proofs')
    .upload(path, file, { upsert: true })

  if (error) {
    console.error('[db] uploadProofDoc error:', error.message)
    return { ok: false, error: error.message }
  }
  return { ok: true, path }
}

// ─── Verification Docs ───────────────────────────────────────────────────────

export async function submitVerificationDoc(
  userId: string,
  company: Company,
  docType: DocType,
  docPath: string,
): Promise<{ ok: boolean; error?: string }> {
  // Mark old pending docs as superseded by upserting a new record
  const { error } = await supabase
    .from('verification_docs')
    .insert({
      user_id: userId,
      company,
      doc_type: docType,
      doc_url: docPath,
      status: 'pending',
    })

  if (error) {
    console.error('[db] submitVerificationDoc error:', error.message)
    return { ok: false, error: error.message }
  }

  // Update profile verification_status → submitted
  await supabase
    .from('profiles')
    .update({ verification_status: 'submitted' })
    .eq('id', userId)

  return { ok: true }
}
