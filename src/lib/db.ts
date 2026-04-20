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
  gender?: 'male' | 'female'
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

  // Build patch — always include id so upsert can match/insert the row
  const patch: Record<string, unknown> = { id: userId }
  if (rest.name          !== undefined) patch.name          = rest.name
  if (rest.gender        !== undefined) patch.gender        = rest.gender
  if (rest.bio           !== undefined) patch.bio           = rest.bio
  if (rest.interests     !== undefined) patch.interests     = rest.interests
  if (rest.age           !== undefined) patch.age           = rest.age
  if (rest.company       !== undefined) patch.company       = rest.company
  if (rest.questionnaire !== undefined) patch.questionnaire = rest.questionnaire
  if (jobTitle           !== undefined) patch.job_title     = jobTitle
  if (photoUrls          !== undefined) patch.photo_urls    = photoUrls

  // Only id key = nothing to save
  if (Object.keys(patch).length <= 1) return { ok: true }

  // upsert: INSERT if row missing, UPDATE if it exists — never silently drops data
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.from('profiles') as any)
    .upsert(patch, { onConflict: 'id' })

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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.from('profiles') as any)
    .upsert({ id: userId, questionnaire: entries }, { onConflict: 'id' })

  if (error) {
    console.error('[db] saveQuestionnaire error:', error.message)
    return { ok: false, error: error.message }
  }
  return { ok: true }
}

// ─── Storage ─────────────────────────────────────────────────────────────────

// Compress image to at most 1080px on the longest side, JPEG quality 0.85
async function compressImage(file: File, maxPx = 1080, quality = 0.85): Promise<File> {
  return new Promise((resolve) => {
    const img = new Image()
    const objectUrl = URL.createObjectURL(file)
    img.onload = () => {
      URL.revokeObjectURL(objectUrl)
      const { naturalWidth: w, naturalHeight: h } = img
      const scale = Math.min(1, maxPx / Math.max(w, h))
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(w * scale)
      canvas.height = Math.round(h * scale)
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      canvas.toBlob(
        (blob) => {
          if (!blob) { resolve(file); return }
          resolve(new File([blob], file.name.replace(/\.\w+$/, '.jpg'), { type: 'image/jpeg' }))
        },
        'image/jpeg',
        quality,
      )
    }
    img.onerror = () => { URL.revokeObjectURL(objectUrl); resolve(file) }
    img.src = objectUrl
  })
}

export async function uploadPhoto(
  userId: string,
  file: File,
): Promise<{ ok: true; path: string } | { ok: false; error: string }> {
  const compressed = await compressImage(file)
  const path = `${userId}/${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`

  const { error } = await supabase.storage
    .from('photos')
    .upload(path, compressed, { upsert: false, contentType: 'image/jpeg' })

  if (error) {
    console.error('[db] uploadPhoto error:', error.message)
    return { ok: false, error: error.message }
  }
  return { ok: true, path }
}

export async function resolvePhotoUrls(paths: string[]): Promise<string[]> {
  if (paths.length === 0) return []

  const resolved = [...paths]
  const storagePaths = paths.filter((path) =>
    path &&
    !path.startsWith('http://') &&
    !path.startsWith('https://') &&
    !path.startsWith('blob:') &&
    !path.startsWith('data:')
  )

  if (storagePaths.length === 0) return resolved

  const { data, error } = await supabase.storage
    .from('photos')
    .createSignedUrls(storagePaths, 60 * 60)

  if (error) {
    console.error('[db] resolvePhotoUrls error:', error.message)
    return resolved
  }

  const signedMap = new Map(
    (data ?? [])
      .filter((item) => item.path && item.signedUrl)
      .map((item) => [item.path, item.signedUrl] as const),
  )

  return resolved.map((path) => signedMap.get(path) ?? path)
}

export async function uploadProofDoc(
  userId: string,
  file: File,
): Promise<{ ok: true; path: string } | { ok: false; error: string }> {
  const isImage = file.type.startsWith('image/')
  const uploadFile = isImage ? await compressImage(file) : file
  const ext = isImage ? 'jpg' : (file.name.split('.').pop() ?? 'pdf')
  const path = `${userId}/${Date.now()}.${ext}`
  const contentType = isImage ? 'image/jpeg' : file.type

  const { error } = await supabase.storage
    .from('proofs')
    .upload(path, uploadFile, { upsert: true, contentType })

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
