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
  /** 在皇冠下方顯示完整收入認證說明（等級 + 年收區間） */
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
    'ring-1 ring-amber-400/35',
    'bg-gradient-to-br from-amber-950/88 via-amber-900/82 to-amber-950/90',
    'text-amber-50',
    'shadow-[0_8px_24px_rgba(146,64,14,0.28)]',
  ),
  silver: cn(
    'ring-1 ring-slate-300/40',
    'bg-gradient-to-br from-slate-900/88 via-slate-800/82 to-slate-900/90',
    'text-slate-50',
    'shadow-[0_8px_24px_rgba(51,65,85,0.28)]',
  ),
  diamond: cn(
    'ring-1 ring-violet-400/40',
    'bg-gradient-to-br from-violet-950/90 via-indigo-900/84 to-violet-950/90',
    'text-violet-50',
    'shadow-[0_8px_24px_rgba(99,102,241,0.32)]',
  ),
}

const incomeRangeAccentClass: Record<IncomeTier, string> = {
  silver: 'text-slate-300',
  gold: 'text-amber-300',
  diamond: 'text-violet-300',
}

/** 探索／卡片：皇冠下方完整收入認證說明（等級名稱 + 年收區間） */
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
        'pointer-events-none z-10 max-w-[min(100%,13.5rem)] rounded-xl px-3 py-2 text-center backdrop-blur-md',
        incomeRangeMetallicClass[tier],
        className,
      )}
    >
      <p className={cn('text-[10px] font-bold tracking-[0.06em]', incomeRangeAccentClass[tier])}>
        {meta.label}
      </p>
      <p className="mt-0.5 text-[12px] font-black leading-tight text-white">
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
          'absolute left-1/2 top-0 z-40 flex -translate-x-1/2 flex-col items-center',
          tier === 'diamond' ? '-translate-y-2' : '-translate-y-1',
        )}
      >
        <IncomeCrownBadge tier={tier} compact={crownCompact} />
        {showIncomeRangeLabel && (
          <IncomeVerificationBadge tier={tier} className="mt-1.5 w-max" />
        )}
      </div>
    </div>
  )
}

// ─── Tier chip ────────────────────────────────────────────────────────────────

export function IncomeTierChip({ tier }: { tier: IncomeTier | null | undefined }) {
  if (!tier) return null
  return <IncomeCrownBadge tier={tier} compact />
}
