import { resolvePhotoUrls } from '@/lib/db'

/** 可作為 `<img src>` 的 URL（已簽章或公開連結）；storage path 不可直接載入 */
export function isDisplayablePhotoUrl(url: string): boolean {
  const s = url.trim()
  return (
    s.startsWith('http://')
    || s.startsWith('https://')
    || s.startsWith('data:')
    || s.startsWith('blob:')
  )
}

export type DiscoverPhotoProfile = {
  photoStoragePaths?: string[]
  photoUrls?: string[]
}

export function storagePathsFromDiscoverProfile(p: DiscoverPhotoProfile): string[] {
  if (p.photoStoragePaths?.length) {
    return p.photoStoragePaths.map((x) => x.trim()).filter(Boolean)
  }
  return (p.photoUrls ?? []).map((x) => x.trim()).filter((x) => x && !isDisplayablePhotoUrl(x))
}

/** 寫入 localStorage 前：只保留 storage path，不存 signed URL */
export function serializeDiscoverProfileForCache<T extends DiscoverPhotoProfile>(profile: T): T {
  const paths = storagePathsFromDiscoverProfile(profile)
  const { photoUrl: _pu, photoUrls: _urls, ...rest } = profile as T & { photoUrl?: string }
  return {
    ...rest,
    photoStoragePaths: paths,
    photoUrls: [] as string[],
  } as unknown as T
}

/** 讀取快取後：不還原 signed URL，等即時簽章 */
export function normalizeDiscoverProfileFromCache<T extends DiscoverPhotoProfile>(raw: T): T {
  const paths = storagePathsFromDiscoverProfile(raw)
  return {
    ...raw,
    photoStoragePaths: paths,
    photoUrls: [] as string[],
  }
}

export async function signDiscoverProfilePhotos<T extends DiscoverPhotoProfile>(profile: T): Promise<T> {
  const paths = profile.photoStoragePaths ?? storagePathsFromDiscoverProfile(profile)
  if (paths.length === 0) {
    const legacy = (profile.photoUrls ?? []).filter(isDisplayablePhotoUrl)
    return { ...profile, photoUrls: legacy }
  }
  const signed = await resolvePhotoUrls(paths)
  return {
    ...profile,
    photoStoragePaths: paths,
    photoUrls: signed.filter(isDisplayablePhotoUrl),
  }
}

export async function signDiscoverProfilePhotosBatch<T extends DiscoverPhotoProfile>(
  profiles: T[],
): Promise<T[]> {
  return Promise.all(profiles.map(signDiscoverProfilePhotos))
}

/** 合併簽章結果：若該列已有可顯示 URL（例如 RPC 較快），不覆蓋 */
export function mergeSignedDiscoverPhotosIntoDeck<T extends DiscoverPhotoProfile & { profileKey?: string }>(
  prev: T[],
  signed: T[],
): T[] {
  if (prev.length === 0) return signed
  if (signed.length !== prev.length) return prev
  return prev.map((cur, i) => {
    const next = signed[i]
    if (!next || (cur.profileKey && next.profileKey && cur.profileKey !== next.profileKey)) {
      return cur
    }
    const curUrls = (cur.photoUrls ?? []).filter(isDisplayablePhotoUrl)
    if (curUrls.length > 0) return cur
    return next
  })
}
