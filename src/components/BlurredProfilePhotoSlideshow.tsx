import { useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Flag, Sparkles } from 'lucide-react'
import { cn } from '@/lib/utils'
import { isDisplayablePhotoUrl } from '@/lib/discoverDeckProfilePhotos'

export function BlurredProfilePhotoSlideshow({
  profileKey,
  photoUrls,
  alt,
  gradientFrom,
  gradientTo,
  variant,
  compatScore,
  onReportClick,
  unblockedIndices,
  highFetchPrioritySlideCount = 0,
}: {
  profileKey: string | number
  photoUrls: string[]
  alt: string
  gradientFrom: string
  gradientTo: string
  variant: 'discover' | 'detail' | 'preview'
  compatScore?: number
  onReportClick?: () => void
  unblockedIndices?: ReadonlySet<number> | number[]
  highFetchPrioritySlideCount?: number
}) {
  const [index, setIndex] = useState(0)
  const [photoLoadState, setPhotoLoadState] = useState<Record<number, 'loading' | 'loaded' | 'error'>>({})
  const touchStartX = useRef<number | null>(null)
  const n = photoUrls.length
  const clearSet =
    unblockedIndices instanceof Set
      ? unblockedIndices
      : new Set(unblockedIndices ?? [])
  const isPreview = variant === 'preview'
  const isDiscoverLike = variant === 'discover' || isPreview

  const gradientBg = `linear-gradient(160deg, ${gradientFrom}, ${gradientTo})`

  useEffect(() => {
    setIndex(0)
    setPhotoLoadState({})
  }, [profileKey, photoUrls.join('|')])

  const markPhotoLoaded = (i: number) => {
    setPhotoLoadState((prev) => (prev[i] === 'loaded' ? prev : { ...prev, [i]: 'loaded' }))
  }

  const markPhotoError = (i: number) => {
    setPhotoLoadState((prev) => (prev[i] === 'error' ? prev : { ...prev, [i]: 'error' }))
  }

  const bindPhotoRef = (el: HTMLImageElement | null, i: number, src: string) => {
    if (!el || !isDisplayablePhotoUrl(src)) return
    if (el.complete && el.naturalWidth > 0) markPhotoLoaded(i)
  }

  const srcAt = (i: number) => photoUrls[i]?.trim() ?? ''
  const currentSrc = n > 0 ? srcAt(index) : ''
  const currentSrcDisplayable = isDisplayablePhotoUrl(currentSrc)
  const currentPhotoState = n > 0
    ? (!currentSrcDisplayable
        ? 'loading'
        : (photoLoadState[index] ?? 'loading'))
    : 'loaded'
  const showPhotoLoading = n > 0 && currentPhotoState !== 'loaded'

  const step = (delta: number) => {
    if (n <= 1 || isPreview) return
    setIndex((i) => (i + delta + n) % n)
  }

  const onTouchStart = (e: React.TouchEvent) => {
    if (isPreview) return
    touchStartX.current = e.touches[0].clientX
  }
  const onTouchEnd = (e: React.TouchEvent) => {
    if (isPreview || touchStartX.current == null || n <= 1) return
    const dx = e.changedTouches[0].clientX - touchStartX.current
    touchStartX.current = null
    if (dx < -56) step(1)
    else if (dx > 56) step(-1)
  }

  const showPrivacy = n > 0 && currentPhotoState === 'loaded'
  const privacyClass = isDiscoverLike
    ? 'absolute z-[25] flex items-center gap-1.5 bg-black/30 backdrop-blur-md rounded-full px-3 py-1.5'
    : 'absolute top-4 left-4 z-[25] flex items-center gap-1.5 bg-black/30 backdrop-blur-md rounded-full px-3 py-1.5'
  const privacyStyle = isDiscoverLike ? { left: '1rem', bottom: '1rem' } : undefined

  return (
    <div
      className="relative w-full flex-shrink-0 overflow-hidden rounded-[0.8rem]"
      style={{ paddingBottom: '150%' }}
    >
      <div
        className="absolute inset-0 overflow-hidden rounded-[0.8rem]"
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        <div
          className="absolute inset-0 z-0"
          style={{ background: gradientBg }}
        />

        {n > 0 &&
          photoUrls.map((src, i) => {
            const trimmed = src.trim()
            if (!isDisplayablePhotoUrl(trimmed)) return null
            const loaded = photoLoadState[i] === 'loaded'
            const visibleIndex = isPreview ? 0 : index
            return (
              <img
                key={`${profileKey}-ph-${i}`}
                ref={(el) => bindPhotoRef(el, i, trimmed)}
                src={trimmed}
                alt=""
                fetchPriority={
                  variant === 'discover' && highFetchPrioritySlideCount > 0 && i < highFetchPrioritySlideCount
                    ? 'high'
                    : undefined
                }
                className={cn(
                  'absolute inset-0 h-full w-full object-cover scale-[1.04] transition-opacity duration-200',
                  i === visibleIndex ? 'z-[1]' : 'z-0 pointer-events-none',
                  loaded && i === visibleIndex ? 'opacity-100' : 'opacity-0',
                )}
                style={clearSet.has(i) ? undefined : { filter: 'blur(6px)' }}
                draggable={false}
                onLoad={() => markPhotoLoaded(i)}
                onError={() => markPhotoError(i)}
              />
            )
          })}

        {showPhotoLoading && (
          <div
            className="absolute inset-0 z-[2] flex flex-col items-center justify-center gap-2 bg-slate-100/95"
            aria-live="polite"
            aria-busy="true"
          >
            <div className="h-8 w-8 rounded-full border-2 border-slate-200 border-t-slate-500 animate-spin" aria-hidden />
            <p className="text-sm font-semibold text-slate-500">
              {currentPhotoState === 'error' ? '無法載入圖片' : '圖片載入中'}
            </p>
          </div>
        )}

        <div className="pointer-events-none absolute inset-0 z-[5] bg-gradient-to-t from-black/70 via-black/20 to-transparent" />

        {n > 1 && !isPreview && (
          <>
            <button
              type="button"
              onClick={() => step(-1)}
              className="absolute left-1 top-1/2 z-[22] flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-black/35 text-white backdrop-blur-sm active:bg-black/50"
              aria-label="上一張"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
            <button
              type="button"
              onClick={() => step(1)}
              className="absolute right-1 top-1/2 z-[22] flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-black/35 text-white backdrop-blur-sm active:bg-black/50"
              aria-label="下一張"
            >
              <ChevronRight className="h-5 w-5" />
            </button>
            <div className="pointer-events-none absolute bottom-3 left-0 right-0 z-[22] flex flex-col items-center gap-1">
              <div className="pointer-events-auto flex items-center gap-1 rounded-full bg-black/35 px-2 py-1 backdrop-blur-md">
                {photoUrls.map((_, i) => (
                  <button
                    key={`dot-${profileKey}-${i}`}
                    type="button"
                    onClick={() => setIndex(i)}
                    className={cn(
                      'h-1.5 rounded-full transition-all',
                      i === index ? 'w-4 bg-white' : 'w-1.5 bg-white/45',
                    )}
                    aria-label={`第 ${i + 1} 張，共 ${n} 張`}
                  />
                ))}
              </div>
              <span className="text-[10px] font-bold tabular-nums text-white/90 drop-shadow">
                {index + 1} / {n}
              </span>
            </div>
          </>
        )}

        {showPrivacy && (
          <div className={privacyClass} style={privacyStyle}>
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-400" />
            <span className="text-[10px] font-semibold text-white/90">隱私保護中</span>
          </div>
        )}

        {variant === 'discover' && (
          <button
            type="button"
            onClick={onReportClick}
            className="absolute left-4 top-4 z-[30] flex items-center gap-1.5 rounded-full bg-black/30 px-3 py-1.5 text-[10px] font-semibold text-white/85 backdrop-blur-md active:bg-black/45"
          >
            <Flag className="h-3.5 w-3.5" />
            檢舉
          </button>
        )}

        {variant === 'detail' && compatScore != null && (
          <div className="absolute bottom-4 right-4 z-[25] flex items-center gap-1.5 rounded-full bg-black/30 px-3 py-1.5 backdrop-blur-md">
            <Sparkles className="h-3.5 w-3.5 text-amber-300" />
            <span className="text-sm font-bold text-white">{compatScore}% 契合</span>
          </div>
        )}
      </div>
      <span className="sr-only">{alt}</span>
    </div>
  )
}
