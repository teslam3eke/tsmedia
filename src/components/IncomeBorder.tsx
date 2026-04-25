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

// ─── Border gradients ─────────────────────────────────────────────────────────

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

  // Diamond: metallic silver-blue base + fine horizontal hairline (brushed metal)
  diamond: [
    // Hairline brushed-metal texture — very fine nearly-horizontal lines
    'repeating-linear-gradient(88deg,' +
      'transparent 0px,' +
      'transparent 1px,' +
      'rgba(255,255,255,0.18) 1px,' +
      'rgba(255,255,255,0.18) 2px,' +
      'transparent 2px,' +
      'transparent 4px,' +
      'rgba(0,0,0,0.06) 4px,' +
      'rgba(0,0,0,0.06) 4.5px,' +
      'transparent 4.5px,' +
      'transparent 8px' +
    ')',
    // Underlying metallic gradient
    'linear-gradient(148deg,' +
      '#60707e 0%,' +
      '#9dafc0 12%,' +
      '#c8d6e2 26%,' +
      '#edf4fa 42%,' +
      '#ffffff 50%,' +
      '#dce8f2 62%,' +
      '#a3b5c4 78%,' +
      '#5e6d7c 100%' +
    ')',
  ].join(', '),
}

// ─── Main component ──────────────────────────────────────────────────────────

export function IncomeBorder({
  tier,
  radius    = '1.4rem',
  thickness = 8,
  className,
  fill      = false,
  children,
}: IncomeBorderProps) {
  if (!tier) return <>{children}</>

  const isDiamond   = tier === 'diamond'
  const borderWidth = isDiamond ? 10 : thickness
  const photoRadius = `calc(${radius} - ${borderWidth}px)`

  return (
    <div
      className={cn('relative', fill && 'h-full w-full', className)}
      style={{
        padding:      borderWidth,
        borderRadius: radius,
        background:   SIMPLE_FRAME_BG[tier],
        boxShadow: isDiamond
          ? [
              '0 6px 18px rgba(15,23,42,0.22)',
              '0 22px 44px rgba(15,23,42,0.14)',
              'inset 0 1.5px 0 rgba(255,255,255,0.82)',
              'inset 0 -1.5px 0 rgba(0,0,0,0.26)',
              'inset 0 0 0 0.5px rgba(255,255,255,0.28)',
            ].join(', ')
          : [
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
            `inset 0 0 0 1px rgba(${
              tier === 'gold'    ? '132,95,28,0.48'  :
              tier === 'diamond' ? '120,145,170,0.52' :
                                   '109,120,134,0.48'
            })`,
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
  const background = SIMPLE_FRAME_BG[tier]
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
