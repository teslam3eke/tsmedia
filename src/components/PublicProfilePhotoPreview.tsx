import type { IncomeTier } from '@/lib/types'
import { cn } from '@/lib/utils'
import { IncomeBorder } from '@/components/IncomeBorder'
import { BlurredProfilePhotoSlideshow } from '@/components/BlurredProfilePhotoSlideshow'

/** 與探索卡片相片區塊同寬，縮放時維持他人可見樣式一致 */
export const PUBLIC_PROFILE_PHOTO_REFERENCE_WIDTH_PX = 280

export type PublicProfilePhotoPreviewProps = {
  profileKey: string
  photoUrls: string[]
  alt: string
  gradientFrom: string
  gradientTo: string
  incomeTier?: IncomeTier | null
  showIncomeBorder?: boolean
  /** 縮小版寬度（px）；預設 280 與探索卡片一致 */
  widthPx?: number
  showIncomeRangeLabel?: boolean
  className?: string
}

export function PublicProfilePhotoPreview({
  profileKey,
  photoUrls,
  alt,
  gradientFrom,
  gradientTo,
  incomeTier,
  showIncomeBorder = false,
  widthPx = PUBLIC_PROFILE_PHOTO_REFERENCE_WIDTH_PX,
  showIncomeRangeLabel = true,
  className,
}: PublicProfilePhotoPreviewProps) {
  const tier = showIncomeBorder && incomeTier ? incomeTier : null
  const scale = widthPx / PUBLIC_PROFILE_PHOTO_REFERENCE_WIDTH_PX
  const innerWidth = PUBLIC_PROFILE_PHOTO_REFERENCE_WIDTH_PX
  const innerPhotoHeight = innerWidth * 1.5
  const innerMargin = 12 * 2
  const innerBlockHeight = innerPhotoHeight + innerMargin
  const scaledHeight = innerBlockHeight * scale
  const crownHeadroom = tier ? Math.max(28, 40 * scale) : 8

  return (
    <div
      className={cn('relative shrink-0 overflow-visible', className)}
      style={{
        width: widthPx,
        height: scaledHeight + crownHeadroom,
      }}
      aria-hidden={false}
    >
      <div
        className="absolute left-0 origin-top-left"
        style={{
          top: crownHeadroom,
          width: innerWidth,
          transform: `scale(${scale})`,
        }}
      >
        <IncomeBorder
          tier={tier}
          radius="1.4rem"
          thickness={8}
          showVerifyMark={false}
          showIncomeRangeLabel={showIncomeRangeLabel && Boolean(tier)}
          className="m-3"
        >
          <BlurredProfilePhotoSlideshow
            profileKey={profileKey}
            photoUrls={photoUrls}
            alt={alt}
            gradientFrom={gradientFrom}
            gradientTo={gradientTo}
            variant="preview"
          />
        </IncomeBorder>
      </div>
    </div>
  )
}
