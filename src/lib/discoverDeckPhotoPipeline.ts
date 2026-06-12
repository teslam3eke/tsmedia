import { resolvePhotoUrls } from '@/lib/db'
import {
  isDisplayablePhotoUrl,
  storagePathsFromDiscoverProfile,
  type DiscoverPhotoProfile,
} from '@/lib/discoverDeckProfilePhotos'

export function discoverProfilePhotoCount(p: DiscoverPhotoProfile): number {
  const paths = storagePathsFromDiscoverProfile(p)
  if (paths.length > 0) return paths.length
  return (p.photoUrls ?? []).filter(isDisplayablePhotoUrl).length
}

export function discoverProfilePhotosFullyLoaded(p: DiscoverPhotoProfile): boolean {
  const expected = discoverProfilePhotoCount(p)
  if (expected === 0) return true
  const loaded = (p.photoUrls ?? []).filter(isDisplayablePhotoUrl).length
  return loaded >= expected
}

export function waitForDiscoverImageUrl(url: string): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve()
  return new Promise((resolve) => {
    const img = new Image()
    try {
      if ('fetchPriority' in img) {
        ;(img as HTMLImageElement & { fetchPriority?: string }).fetchPriority = 'high'
      }
    } catch {
      /* ignore */
    }
    img.decoding = 'async'
    const done = () => resolve()
    img.onload = done
    img.onerror = done
    img.src = url
  })
}

export async function signDiscoverPhotoPath(path: string): Promise<string | null> {
  const [signed] = await resolvePhotoUrls([path])
  const s = String(signed ?? '').trim()
  return isDisplayablePhotoUrl(s) ? s : null
}

/**
 * 單人相片：先簽＋載入第一張，完成後再依序處理其餘。
 * `onPartial` 每多一張可顯示 URL 就回呼一次。
 */
export async function loadDiscoverProfilePhotosSequential(
  profile: DiscoverPhotoProfile,
  onPartial: (photoUrls: string[]) => void,
  isStale: () => boolean,
): Promise<string[]> {
  const legacy = (profile.photoUrls ?? []).filter(isDisplayablePhotoUrl)
  if (legacy.length > 0 && storagePathsFromDiscoverProfile(profile).length === 0) {
    onPartial(legacy)
    return legacy
  }

  const paths = storagePathsFromDiscoverProfile(profile)
  if (paths.length === 0) {
    onPartial([])
    return []
  }

  const existing = (profile.photoUrls ?? []).filter(isDisplayablePhotoUrl)
  const urls: string[] = [...existing]
  const startIdx = urls.length

  for (let i = startIdx; i < paths.length; i++) {
    if (isStale()) return urls
    const signed = await signDiscoverPhotoPath(paths[i])
    if (!signed) continue
    urls.push(signed)
    onPartial([...urls])
    await waitForDiscoverImageUrl(signed)
    if (isStale()) return urls
  }

  return urls
}

/** 目前卡片優先，其次下一位；其餘依索引補齊（還原 session 時避免先載很久以前的卡片）。 */
export function buildDiscoverPhotoLoadOrder(horizonProfileIndex: number, currentCardIndex: number): number[] {
  const horizon = Math.max(0, horizonProfileIndex)
  const current = Math.max(0, currentCardIndex)
  const order: number[] = []
  const seen = new Set<number>()
  const add = (i: number) => {
    if (i < 0 || i > horizon || seen.has(i)) return
    seen.add(i)
    order.push(i)
  }
  add(current)
  add(current + 1)
  for (let i = 0; i <= horizon; i += 1) add(i)
  return order
}

export async function runDiscoverDeckPhotoPipeline<T extends DiscoverPhotoProfile & { profileKey: string }>(opts: {
  orderedProfiles: T[]
  horizonProfileIndex: number
  currentCardIndex: number
  getProfileByKey: (profileKey: string) => T | undefined
  patchProfilePhotos: (profileKey: string, photoUrls: string[]) => void
  isStale: () => boolean
}): Promise<void> {
  const {
    orderedProfiles,
    horizonProfileIndex,
    currentCardIndex,
    getProfileByKey,
    patchProfilePhotos,
    isStale,
  } = opts

  if (orderedProfiles.length === 0) return

  const horizon = Math.min(
    Math.max(horizonProfileIndex, currentCardIndex + 1),
    orderedProfiles.length - 1,
  )
  const loadOrder = buildDiscoverPhotoLoadOrder(horizon, currentCardIndex)

  for (const profileIndex of loadOrder) {
    if (isStale()) return
    const seed = orderedProfiles[profileIndex]
    if (!seed?.profileKey) continue

    const profile = getProfileByKey(seed.profileKey) ?? seed
    if (discoverProfilePhotosFullyLoaded(profile)) continue

    await loadDiscoverProfilePhotosSequential(
      profile,
      (photoUrls) => {
        if (isStale()) return
        patchProfilePhotos(seed.profileKey, photoUrls)
      },
      isStale,
    )
  }
}
