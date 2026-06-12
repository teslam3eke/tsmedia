/** Supabase signed URL 有效期 3600s；記憶體快取略短以免邊界過期。 */
const SIGNED_PHOTO_URL_CACHE_TTL_MS = 55 * 60 * 1000

const cache = new Map<string, { url: string; expiresAt: number }>()

function normalizeStoragePath(path: string): string {
  return path.trim()
}

/** 同步讀取仍有效的 signed URL（「我的」頁首屏、避免切 tab 閃空白）。 */
export function peekSignedPhotoUrlCache(path: string): string | null {
  const key = normalizeStoragePath(path)
  if (!key) return null
  const hit = cache.get(key)
  if (!hit) return null
  if (Date.now() >= hit.expiresAt) {
    cache.delete(key)
    return null
  }
  return hit.url
}

export function putSignedPhotoUrlCache(path: string, url: string): void {
  const key = normalizeStoragePath(path)
  const u = url.trim()
  if (!key || !u.startsWith('http')) return
  cache.set(key, { url: u, expiresAt: Date.now() + SIGNED_PHOTO_URL_CACHE_TTL_MS })
}

export function invalidateSignedPhotoUrlCache(path?: string): void {
  if (path == null) {
    cache.clear()
    return
  }
  cache.delete(normalizeStoragePath(path))
}
