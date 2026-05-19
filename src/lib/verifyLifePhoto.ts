import { supabase } from './supabase'

/** 生活照 AI 審核（上傳前呼叫 /api/verify-life-photo） */

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

export type VerifyLifePhotoResult =
  | { ok: true; message: string; remaining?: number }
  | {
      ok: false
      message: string
      limited?: boolean
      failuresToday?: number
      remaining?: number
    }

async function authHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  try {
    const { data } = await supabase.auth.getSession()
    const token = data.session?.access_token
    if (token) headers.Authorization = `Bearer ${token}`
  } catch {
    /* ignore */
  }
  return headers
}

export async function verifyLifePhotoCompressed(file: File): Promise<VerifyLifePhotoResult> {
  try {
    const imageBase64 = await fileToDataUrl(file)
    const res = await fetch('/api/verify-life-photo', {
      method: 'POST',
      headers: await authHeaders(),
      body: JSON.stringify({ imageBase64 }),
    })
    const data = (await res.json()) as {
      ok?: boolean
      message?: string
      limited?: boolean
      failuresToday?: number
      remaining?: number
    }
    if (!res.ok) {
      return { ok: false, message: data.message ?? '照片審核失敗，請稍後再試' }
    }
    if (!data.ok) {
      return {
        ok: false,
        message: data.message ?? '此照片不符合生活照要求，請重新選擇',
        limited: data.limited,
        failuresToday: data.failuresToday,
        remaining: data.remaining,
      }
    }
    return {
      ok: true,
      message: data.message ?? 'OK',
      remaining: data.remaining,
    }
  } catch {
    return { ok: false, message: '照片審核失敗，請檢查網路後再試' }
  }
}
