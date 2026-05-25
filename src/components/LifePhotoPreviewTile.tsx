import type { IncomeTier } from '@/lib/types'
import { cn } from '@/lib/utils'
import { IncomeBorder } from '@/components/IncomeBorder'

/** 與 {@link LifePhotoUploadSection} 網格單格一致 */
export function LifePhotoPreviewTile({
  photoUrl,
  incomeTier,
  showCrown = false,
  showUploadedBadge = false,
  className,
}: {
  photoUrl?: string | null
  incomeTier?: IncomeTier | null
  showCrown?: boolean
  showUploadedBadge?: boolean
  className?: string
}) {
  const tier = showCrown && incomeTier ? incomeTier : null

  const tile = (
    <div className={cn('relative aspect-square rounded-2xl overflow-hidden bg-slate-100', className)}>
      {photoUrl ? (
        <>
          <img
            src={photoUrl}
            alt=""
            className="h-full w-full object-cover scale-110"
            style={{ filter: 'blur(6px)' }}
          />
          <div className="absolute inset-0 bg-black/10" />
        </>
      ) : (
        <div className="flex h-full w-full items-center justify-center px-2 text-center text-[10px] font-medium text-slate-400">
          尚無生活照
        </div>
      )}
      {showUploadedBadge && photoUrl ? (
        <div className="absolute bottom-2 left-2 right-2 rounded-xl bg-white/80 px-2.5 py-1.5 backdrop-blur-sm">
          <p className="text-center text-[10px] font-semibold tracking-wide text-slate-700">已上傳</p>
        </div>
      ) : null}
    </div>
  )

  if (!tier) return tile

  return (
    <div className="relative overflow-visible pt-1">
      <IncomeBorder tier={tier} crownCompact className="block w-full">
        {tile}
      </IncomeBorder>
    </div>
  )
}
