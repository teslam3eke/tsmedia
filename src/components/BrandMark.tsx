import { cn } from '@/lib/utils'

/** App 內小 logo（Landing／Auth／主殼頂部等） */
export const BRAND_MARK_SRC = '/assets/brand/logo-mark.svg'
export const BRAND_MARK_SRC_PNG = '/assets/brand/logo-mark.png'

type BrandMarkProps = {
  className?: string
  /** 外框容器 class（含圓角／底色時用） */
  frameClassName?: string
  imgClassName?: string
  /** 是否包一層與現有 Cpu 方塊一致的底 */
  framed?: boolean
  alt?: string
}

export function BrandMark({
  className,
  frameClassName,
  imgClassName,
  framed = false,
  alt = 'tsMedia',
}: BrandMarkProps) {
  const img = (
    <img
      src={BRAND_MARK_SRC_PNG}
      alt={alt}
      className={cn('h-full w-full object-contain', imgClassName)}
      draggable={false}
    />
  )

  if (!framed) {
    return <div className={cn('shrink-0', className)}>{img}</div>
  }

  return (
    <div
      className={cn(
        'flex shrink-0 items-center justify-center overflow-hidden',
        frameClassName,
        className,
      )}
    >
      {img}
    </div>
  )
}
