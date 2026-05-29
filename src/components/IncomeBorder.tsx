import type { ReactNode } from 'react'
import type { IncomeTier } from '@/lib/types'
import { INCOME_TIER_META } from '@/lib/types'
import { cn } from '@/lib/utils'

export interface IncomeBorderProps {
  tier: IncomeTier | null | undefined
  radius?: string
  thickness?: number
  className?: string
  fill?: boolean
  showVerifyMark?: boolean
  crownCompact?: boolean
  /** 在照片右上角顯示完整收入認證說明（等級 + 年收區間） */
  showIncomeRangeLabel?: boolean
  children: ReactNode
}

// ─── Crown theme ───────────────────────────────────────────────────────────────

const CROWN_ASSET: Record<IncomeTier, { label: string; src: string }> = {
  silver:  { label: '銀皇冠', src: '/assets/images/silver-crown-badge-v3.png' },
  gold:    { label: '金皇冠', src: '/assets/images/gold-crown-badge-v3.png' },
  diamond: { label: '鑽石皇冠', src: '/assets/images/diamond-crown-badge-previous.png' },
}

export function IncomeCrownBadge({
  tier,
  compact = false,
  className,
}: {
  tier: IncomeTier | null | undefined
  compact?: boolean
  className?: string
}) {
  if (!tier) return null
  const asset = CROWN_ASSET[tier]

  return (
    <img
      src={asset.src}
      alt={asset.label}
      className={cn(
        'pointer-events-none select-none object-contain',
        tier === 'diamond'
          ? 'drop-shadow-[0_14px_30px_rgba(99,102,241,0.38)]'
          : tier === 'gold'
            ? 'drop-shadow-[0_14px_26px_rgba(217,119,6,0.34)]'
            : 'drop-shadow-[0_14px_26px_rgba(100,116,139,0.30)]',
        tier === 'diamond'
          ? compact ? 'h-10 w-20' : 'h-20 w-36'
          : compact ? 'h-10 w-24' : 'h-20 w-48',
        className,
      )}
      draggable={false}
    />
  )
}

// ─── Main component ──────────────────────────────────────────────────────────

// ─── Income range label (metallic chip next to crown) ───────────────────────

const incomeRangeMetallicClass: Record<IncomeTier, string> = {
  gold: cn(
    'ring-1 ring-amber-300/45',
    'bg-gradient-to-br from-amber-900/52 via-amber-800/48 to-amber-900/55',
    'text-amber-50/90',
    'shadow-[0_6px_18px_rgba(146,64,14,0.16)]',
  ),
  silver: cn(
    'ring-1 ring-slate-200/50',
    'bg-gradient-to-br from-slate-800/52 via-slate-700/48 to-slate-800/55',
    'text-slate-50/90',
    'shadow-[0_6px_18px_rgba(51,65,85,0.16)]',
  ),
  diamond: cn(
    'ring-1 ring-violet-300/45',
    'bg-gradient-to-br from-violet-900/55 via-indigo-800/50 to-violet-900/55',
    'text-violet-50/90',
    'shadow-[0_6px_18px_rgba(99,102,241,0.18)]',
  ),
}

const incomeRangeAccentClass: Record<IncomeTier, string> = {
  silver: 'text-slate-200/85',
  gold: 'text-amber-200/90',
  diamond: 'text-violet-200/90',
}

/** 探索／卡片：照片右上角完整收入認證說明（等級名稱 + 年收區間） */
export function IncomeVerificationBadge({
  tier,
  className,
}: {
  tier: IncomeTier
  className?: string
}) {
  const meta = INCOME_TIER_META[tier]
  return (
    <div
      className={cn(
        'pointer-events-none z-40 max-w-[min(46%,10.5rem)] rounded-xl px-2.5 py-1.5 text-left backdrop-blur-sm sm:max-w-[11rem] sm:px-3 sm:py-2',
        incomeRangeMetallicClass[tier],
        className,
      )}
    >
      <p className={cn('text-[9px] font-bold tracking-[0.04em] sm:text-[10px]', incomeRangeAccentClass[tier])}>
        {meta.label}
      </p>
      <p className="mt-0.5 text-[11px] font-black leading-tight text-white/90 sm:text-[12px]">
        年收 {meta.range}
      </p>
    </div>
  )
}

export function IncomeBorder({
  tier,
  className,
  fill = false,
  crownCompact = false,
  showIncomeRangeLabel = false,
  children,
}: IncomeBorderProps) {
  if (!tier) return <>{children}</>

  return (
    <div
      className={cn(
        'relative',
        fill && 'h-full w-full',
        className,
      )}
    >
      {children}
      <div
        className={cn(
          'absolute left-1/2 top-0 z-40 -translate-x-1/2',
          tier === 'diamond' ? '-translate-y-2' : '-translate-y-1',
        )}
      >
        <IncomeCrownBadge tier={tier} compact={crownCompact} />
      </div>
      {showIncomeRangeLabel && (
        <IncomeVerificationBadge
          tier={tier}
          className="absolute right-2 top-2 sm:right-3 sm:top-3"
        />
      )}
    </div>
  )
}

// ─── Tier chip ────────────────────────────────────────────────────────────────

export function IncomeTierChip({ tier }: { tier: IncomeTier | null | undefined }) {
  if (!tier) return null
  return <IncomeCrownBadge tier={tier} compact />
}
