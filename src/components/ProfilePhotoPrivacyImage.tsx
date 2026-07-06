import { forwardRef, useEffect, useState, type CSSProperties, type SyntheticEvent } from 'react'
import { cn } from '@/lib/utils'
import { profilePhotoPrivacyBlurFilter } from '@/lib/profilePhotoPrivacyBlur'

/** 阻擋 iOS 長按「儲存圖片」／預覽原圖 */
export const profilePhotoPrivacyGuardClass =
  'select-none [-webkit-user-select:none] [-webkit-touch-callout:none]'

export function preventProfilePhotoContextMenu(e: SyntheticEvent) {
  e.preventDefault()
}

export type ProfilePhotoPrivacyImageProps = {
  src: string
  alt?: string
  className?: string
  style?: CSSProperties
  /** false = 仍霧化（預設） */
  privacyCleared?: boolean
  fetchPriority?: 'high' | 'low' | 'auto'
  decoding?: 'async' | 'auto' | 'sync'
  onLoad?: () => void
  onError?: () => void
}

/**
 * 霧化生活照：可見層用 div + background-image（iOS 長按不會彈出清晰原圖）。
 * 載入偵測用隱藏 img；ref 指向該 img 供 naturalWidth 檢查。
 */
export const ProfilePhotoPrivacyImage = forwardRef<HTMLImageElement, ProfilePhotoPrivacyImageProps>(
  function ProfilePhotoPrivacyImage(
    {
      src,
      alt = '',
      className,
      style,
      privacyCleared = false,
      fetchPriority,
      decoding = 'async',
      onLoad,
      onError,
    },
    ref,
  ) {
    const [loaded, setLoaded] = useState(false)

    useEffect(() => {
      setLoaded(false)
    }, [src])

    const handleLoad = () => {
      setLoaded(true)
      onLoad?.()
    }

    if (privacyCleared) {
      return (
        <img
          ref={ref}
          src={src}
          alt={alt}
          className={cn(profilePhotoPrivacyGuardClass, className)}
          style={style}
          draggable={false}
          fetchPriority={fetchPriority}
          decoding={decoding}
          onContextMenu={preventProfilePhotoContextMenu}
          onLoad={handleLoad}
          onError={onError}
        />
      )
    }

    return (
      <>
        <img
          ref={ref}
          src={src}
          alt=""
          className="sr-only"
          aria-hidden
          draggable={false}
          fetchPriority={fetchPriority}
          decoding={decoding}
          onLoad={handleLoad}
          onError={onError}
        />
        <div
          role="presentation"
          aria-hidden
          className={cn(profilePhotoPrivacyGuardClass, 'pointer-events-none', className)}
          style={{
            ...style,
            backgroundImage: loaded ? `url("${src.replace(/"/g, '\\"')}")` : undefined,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            filter: loaded ? profilePhotoPrivacyBlurFilter() : undefined,
          }}
        />
      </>
    )
  },
)

/** 疊在拼圖／SVG 照上，阻擋長按穿透 */
export function ProfilePhotoPrivacyTouchShield({ className }: { className?: string }) {
  return (
    <div
      className={cn('absolute inset-0 z-[20]', profilePhotoPrivacyGuardClass, className)}
      role="presentation"
      aria-hidden
      onContextMenu={preventProfilePhotoContextMenu}
    />
  )
}
