import { supabase } from './supabase'
import { uploadPhoto } from './db'
import { verifyLifePhotoCompressed } from './verifyLifePhoto'

export const LIFE_PHOTO_DAILY_FAILURE_LIMIT = 10

export type LifePhotoFailureStatus = {
  count: number
  limit: number
  remaining: number
  limited: boolean
}

export type LifePhotoUploadResult =
  | { ok: true; path: string }
  | { ok: false; error: string; limited?: boolean; failuresToday?: number }

async function compressProfilePhoto(file: File, maxPx = 1080, quality = 0.85): Promise<File> {
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
          if (!blob) {
            resolve(file)
            return
          }
          resolve(new File([blob], file.name.replace(/\.\w+$/, '.jpg'), { type: 'image/jpeg' }))
        },
        'image/jpeg',
        quality,
      )
    }
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl)
      resolve(file)
    }
    img.src = objectUrl
  })
}

export async function getLifePhotoVerifyFailureStatus(): Promise<LifePhotoFailureStatus> {
  const fallback: LifePhotoFailureStatus = {
    count: 0,
    limit: LIFE_PHOTO_DAILY_FAILURE_LIMIT,
    remaining: LIFE_PHOTO_DAILY_FAILURE_LIMIT,
    limited: false,
  }
  try {
    const { data, error } = await supabase.rpc('get_my_life_photo_verify_failure_status')
    if (error) {
      console.warn('[lifePhotoUpload] failure status', error.message)
      return fallback
    }
    const row = data as {
      count?: number
      limit?: number
      remaining?: number
      limited?: boolean
    } | null
    const limit = row?.limit ?? LIFE_PHOTO_DAILY_FAILURE_LIMIT
    const count = row?.count ?? 0
    return {
      count,
      limit,
      remaining: row?.remaining ?? Math.max(0, limit - count),
      limited: row?.limited ?? count >= limit,
    }
  } catch {
    return fallback
  }
}

/** 先 AI 審核（含每日失敗上限），通過後寫入 Storage */
export async function verifyAndUploadLifePhoto(
  userId: string,
  file: File,
): Promise<LifePhotoUploadResult> {
  const status = await getLifePhotoVerifyFailureStatus()
  if (status.limited) {
    return {
      ok: false,
      limited: true,
      failuresToday: status.count,
      error: `今日生活照審核失敗已達 ${LIFE_PHOTO_DAILY_FAILURE_LIMIT} 次，請明日再試（每晚 10 點換日）。`,
    }
  }

  const compressed = await compressProfilePhoto(file)
  const verify = await verifyLifePhotoCompressed(compressed)
  if (!verify.ok) {
    const next = await getLifePhotoVerifyFailureStatus()
    return {
      ok: false,
      error: verify.message,
      limited: verify.limited,
      failuresToday: verify.failuresToday ?? next.count,
    }
  }

  const uploaded = await uploadPhoto(userId, compressed, { skipVerify: true })
  if (!uploaded.ok) {
    return { ok: false, error: uploaded.error }
  }
  return { ok: true, path: uploaded.path }
}
