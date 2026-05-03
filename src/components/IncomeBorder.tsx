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
  /** 在皇冠右側顯示對應年收（如「300萬+」） */
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
    'border border-amber-300/90',
    'bg-gradient-to-b from-amber-50 via-yellow-200 to-amber-400',
    'text-amber-950',
    'shadow-[inset_0_1px_0_rgba(255,255,255,0.75),inset_0_-1px_0_rgba(180,83,9,0.15),0_2px_10px_rgba(146,64,14,0.35)]',
    '[text-shadow:0_0.5px_0_rgba(255,255,255,0.9)]',
  ),
  silver: cn(
    'border border-slate-300/90',
    'bg-gradient-to-b from-slate-100 via-slate-200 to-slate-400',
    'text-slate-900',
    'shadow-[inset_0_1px_0_rgba(255,255,255,0.8),inset_0_-1px_0_rgba(15,23,42,0.12),0_2px_10px_rgba(51,65,85,0.3)]',
    '[text-shadow:0_0.5px_0_rgba(255,255,255,0.85)]',
  ),
  diamond: cn(
    'border border-violet-300/80',
    'bg-gradient-to-b from-violet-100 via-indigo-200 to-violet-400',
    'text-violet-950',
    'shadow-[inset_0_1px_0_rgba(255,255,255,0.7),inset_0_-1px_0_rgba(67,56,202,0.2),0_2px_12px_rgba(99,102,241,0.35)]',
    '[text-shadow:0_0.5px_0_rgba(255,255,255,0.85)]',
  ),
}

function IncomeRangeMetallicLabel({ tier, className }: { tier: IncomeTier; className?: string }) {
  const text = INCOME_TIER_META[tier].range
  return (
    <span
      className={cn(
        'pointer-events-none z-10 shrink-0 whitespace-nowrap rounded-lg px-2.5 py-1.5',
        'text-[11px] font-semibold tracking-[0.02em] sm:text-xs sm:font-bold',
        incomeRangeMetallicClass[tier],
        className,
      )}
    >
      {text}
    </span>
  )
}

export function IncomeBorder({
  tier,
  className,
  fill      = false,
  crownCompact = false,
  showIncomeRangeLabel = false,
  children,
}: IncomeBorderProps) {
  if (!tier) return <>{children}</>

  return (
    <div
      className={cn(
        'relative',
        'pt-0',
        fill && 'h-full w-full',
        className,
      )}
    >
      {children}
      {/*
        皇冠置中邏輯與舊版一致：外層以畫面左右中線為基準，內層寬度＝皇冠寬度（年收為 absolute 不參與寬度），
        故 -translate-x-1/2 置中的是「皇冠」本體，不會因加字而左移。年收只貼在皇冠右緣外側。
      */}
      <div
        className={cn(
          'absolute left-1/2 top-0 z-40 -translate-x-1/2',
          tier === 'diamond' ? '-translate-y-2' : '-translate-y-1',
        )}
      >
        <div className="relative inline-block leading-none">
          <IncomeCrownBadge tier={tier} compact={crownCompact} />
          {showIncomeRangeLabel && (
            <IncomeRangeMetallicLabel
              tier={tier}
              className="absolute left-full top-1/2 ml-1.5 -translate-y-1/2 sm:ml-2"
            />
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Tier chip ────────────────────────────────────────────────────────────────

export function IncomeTierChip({ tier }: { tier: IncomeTier | null | undefined }) {
  if (!tier) return null
  return <IncomeCrownBadge tier={tier} compact />
}
