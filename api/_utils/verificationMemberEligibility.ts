import type { AutoTextRejectPresetId } from './verificationRejectPresetMessages.js'

export const MEMBER_PROFILE_PHOTO_MIN = 1

export type MemberEligibilityResult =
  | { ok: true }
  | { ok: false; uncertain: boolean; presetId: AutoTextRejectPresetId; detail: string }

type ProfileRow = {
  verification_status?: string | null
  name?: string | null
  gender?: string | null
  company?: string | null
  photo_urls?: string[] | null
}

/** 非 OpenAI：送審當下可確認的會員資格（生活照路徑、必填欄位）。 */
export function checkMemberEligibilityForAutoReview(profile: ProfileRow): MemberEligibilityResult {
  if (profile.verification_status === 'approved') {
    return { ok: false, uncertain: false, presetId: 'photos_insufficient', detail: 'already_approved' }
  }

  const photos = (profile.photo_urls ?? []).map((p) => (typeof p === 'string' ? p.trim() : '')).filter(Boolean)
  if (photos.length < MEMBER_PROFILE_PHOTO_MIN) {
    return {
      ok: false,
      uncertain: false,
      presetId: 'photos_insufficient',
      detail: 'photo_count',
    }
  }

  const name = profile.name?.trim() ?? ''
  if (!name) {
    return { ok: false, uncertain: true, presetId: 'photos_insufficient', detail: 'missing_name' }
  }

  const gender = profile.gender
  if (gender !== 'male' && gender !== 'female') {
    return { ok: false, uncertain: true, presetId: 'photos_insufficient', detail: 'missing_gender' }
  }

  const company = profile.company?.trim() ?? ''
  if (company.length < 2) {
    return { ok: false, uncertain: true, presetId: 'photos_insufficient', detail: 'missing_company' }
  }

  return { ok: true }
}
