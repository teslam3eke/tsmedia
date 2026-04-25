import type { ReactNode } from 'react'
import type { IncomeTier } from '@/lib/types'
import { cn } from '@/lib/utils'

export interface IncomeBorderProps {
  tier: IncomeTier | null | undefined
  radius?: string
  thickness?: number
  className?: string
  fill?: boolean
  showVerifyMark?: boolean
  assetFrame?: boolean
  children: ReactNode
}

// PNG frame asset — RGBA with transparent photo window in the center.
// Measured from the actual PNG (422×572):
//   paddingBottom = 572/422 = 135.545%
//   top/bottom inset = 23/572 = 4.021%
//   left/right inset = 29/422 = 6.872%
const PREMIUM_FRAME_ASSET = '/assets/images/premium_authentication_frame_v2.png'

const SIMPLE_FRAME_BG: Record<IncomeTier, string> = {
  silver: `linear-gradient(148deg,
    #66707b 0%,
    #98a1ab 14%,
    #bcc4cd 28%,
    #edf1f5 46%,
    #f8fbff 52%,
    #dce3eb 63%,
    #aab3bd 80%,
    #6b7480 100%)`,
  gold: `linear-gradient(148deg,
    #7b5418 0%,
    #a97b32 16%,
    #d8b06b 32%,
    #f3deb0 48%,
    #faefcf 54%,
    #e2bf7d 68%,
    #af8335 84%,
    #7a5319 100%)`,
  diamond: `linear-gradient(148deg,
    #707986 0%,
    #aab3be 16%,
    #c9d1db 30%,
    #eef3f8 46%,
    #fbfdff 52%,
    #dde4ec 66%,
    #a8b0ba 82%,
    #6e7682 100%)`,
}

// ─── Main component ──────────────────────────────────────────────────────────

export function IncomeBorder({
  tier,
  radius    = '1.4rem',
  thickness = 8,
  className,
  fill      = false,
  assetFrame = false,
  children,
}: IncomeBorderProps) {
  if (!tier) return <>{children}</>

  const isDiamond     = tier === 'diamond'
  const useAssetFrame = isDiamond && assetFrame

  if (useAssetFrame) {
    return (
      <div
        className={cn('relative', fill && 'h-full w-full', className)}
        style={{ borderRadius: radius }}
      >
        {/* Aspect-ratio spacer — matches PNG 422 × 572 */}
        <div aria-hidden className="w-full" style={{ paddingBottom: '135.545%' }} />

        {/* Photo window — z-0, sits behind the frame PNG */}
        <div
          className="absolute z-0 overflow-hidden"
          style={{
            top:    '4.021%',
            right:  '6.872%',
            bottom: '4.021%',
            left:   '6.872%',
            borderRadius: '0.9rem',
            boxShadow: 'inset 0 0 18px rgba(0,0,0,0.08)',
          }}
        >
          {children}
        </div>

        {/* Frame PNG — z-20, always above the photo */}
        <div className="absolute inset-0 pointer-events-none" style={{ zIndex: 20 }}>
          <img
            src={PREMIUM_FRAME_ASSET}
            alt=""
            aria-hidden
            draggable={false}
            className="w-full h-full select-none"
            style={{ objectFit: 'fill', display: 'block' }}
          />
        </div>
      </div>
    )
  }

  const photoRadius = `calc(${radius} - ${thickness}px)`

  return (
    <div
      className={cn('relative', fill && 'h-full w-full', className)}
      style={{
        padding:      thickness,
        borderRadius: radius,
        background:   SIMPLE_FRAME_BG[tier],
        boxShadow: [
          '0 4px 10px rgba(15,23,42,0.16)',
          '0 18px 34px rgba(15,23,42,0.12)',
          'inset 0 1.2px 0 rgba(255,255,255,0.72)',
          'inset 0 -1.2px 0 rgba(0,0,0,0.22)',
          'inset 0 0 0 0.5px rgba(0,0,0,0.18)',
        ].join(', '),
      }}
    >
      <div
        className={cn(fill && 'h-full w-full')}
        style={{
          margin:       1,
          borderRadius: photoRadius,
          overflow:     'hidden',
          boxShadow: [
            `inset 0 0 0 1px rgba(${tier === 'gold' ? '132,95,28,0.48' : '109,120,134,0.48'})`,
            'inset 0 0 16px rgba(0,0,0,0.08)',
          ].join(', '),
        }}
      >
        {children}
      </div>
    </div>
  )
}

// ─── Tier chip ────────────────────────────────────────────────────────────────

export function IncomeTierChip({ tier }: { tier: IncomeTier | null | undefined }) {
  if (!tier) return null
  const label = tier === 'silver' ? '銀' : tier === 'gold' ? '金' : '鑽'
  const background = tier === 'diamond'
    ? `linear-gradient(148deg,
      #707986 0%,
      #aab3be 16%,
      #c9d1db 30%,
      #eef3f8 46%,
      #fbfdff 52%,
      #dde4ec 66%,
      #a8b0ba 82%,
      #6e7682 100%)`
    : SIMPLE_FRAME_BG[tier]
  return (
    <span
      className="inline-flex items-center justify-center text-[10px] font-bold leading-none px-1.5 py-0.5 rounded-md"
      style={{
        background,
        color:      tier === 'gold' ? '#3a2608' : '#1e293b',
        boxShadow: [
          '0 1px 2px rgba(0,0,0,0.22)',
          'inset 0  1px 0 rgba(255,255,255,0.58)',
          'inset 0 -1px 0 rgba(0,0,0,0.20)',
        ].join(', '),
        minWidth: 18,
      }}
    >
      {label}
    </span>
  )
}
