import { useId, type ReactNode } from 'react'
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

// ─── Inline SVG diamond frame ────────────────────────────────────────────────
// Rendered directly in JSX to avoid any external-SVG-as-<img> rendering quirks.
// ViewBox: 1440 × 2048 (aspect ratio ≈ 1 : 1.4222)
// Photo window: x 96–1344, y 88–1960 (inset 6.667% LR, 4.297% TB)

function DiamondFrame() {
  const uid   = useId().replace(/[^a-z0-9]/gi, 'x')
  const mId   = `${uid}m`   // metal gradient
  const gId   = `${uid}g`   // glow gradient
  const eId   = `${uid}e`   // edge shade
  const kId   = `${uid}k`   // mask (cuts photo window)
  const dId   = `${uid}d`   // medal gradient

  return (
    <svg
      aria-hidden
      focusable="false"
      className="absolute inset-0 w-full h-full pointer-events-none select-none"
      style={{ zIndex: 20 }}
      viewBox="0 0 1440 2048"
      preserveAspectRatio="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        {/* Metallic silver-diamond gradient — diagonal */}
        <linearGradient id={mId} x1="0" y1="0" x2="1440" y2="2048" gradientUnits="userSpaceOnUse">
          <stop offset="0%"   stopColor="#8FA2B9"/>
          <stop offset="10%"  stopColor="#F7FBFF"/>
          <stop offset="25%"  stopColor="#CBD9E9"/>
          <stop offset="42%"  stopColor="#FFFFFF"/>
          <stop offset="55%"  stopColor="#DDEAF7"/>
          <stop offset="72%"  stopColor="#F8FDFF"/>
          <stop offset="100%" stopColor="#7D8DA1"/>
        </linearGradient>

        {/* Top-left sparkle */}
        <linearGradient id={gId} x1="0" y1="0" x2="1440" y2="2048" gradientUnits="userSpaceOnUse">
          <stop offset="0%"   stopColor="#FFFFFF" stopOpacity="0.88"/>
          <stop offset="40%"  stopColor="#B8CCE0" stopOpacity="0.28"/>
          <stop offset="100%" stopColor="#6E7D90" stopOpacity="0.06"/>
        </linearGradient>

        {/* Top-to-bottom edge shading for depth */}
        <linearGradient id={eId} x1="720" y1="0" x2="720" y2="2048" gradientUnits="userSpaceOnUse">
          <stop offset="0%"   stopColor="#FFFFFF" stopOpacity="0.92"/>
          <stop offset="18%"  stopColor="#FFFFFF" stopOpacity="0.16"/>
          <stop offset="82%"  stopColor="#516174" stopOpacity="0.12"/>
          <stop offset="100%" stopColor="#263447"  stopOpacity="0.28"/>
        </linearGradient>

        {/* Medal gradient */}
        <linearGradient id={dId} x1="1140" y1="1186" x2="1294" y2="1334" gradientUnits="userSpaceOnUse">
          <stop offset="0%"   stopColor="#F4F7FB"/>
          <stop offset="36%"  stopColor="#FFFFFF"/>
          <stop offset="68%"  stopColor="#C6CED7"/>
          <stop offset="100%" stopColor="#909BA7"/>
        </linearGradient>

        {/* Mask: full frame visible (white) minus photo window (black = transparent) */}
        <mask id={kId}>
          <rect width="1440" height="2048" fill="white"/>
          <rect x="96" y="88" width="1248" height="1872" rx="68" ry="68" fill="black"/>
        </mask>
      </defs>

      {/* ── Frame ring ── */}
      <rect x="10" y="5"   width="1420" height="2038" rx="82" ry="82"
        fill={`url(#${mId})`}  mask={`url(#${kId})`}/>
      <rect x="10" y="5"   width="1420" height="2038" rx="82" ry="82"
        fill={`url(#${gId})`}  mask={`url(#${kId})`}/>
      <rect x="10" y="5"   width="1420" height="2038" rx="82" ry="82"
        fill={`url(#${eId})`}  mask={`url(#${kId})`} opacity="0.7"/>

      {/* ── Outer edge highlight ── */}
      <rect x="14" y="9" width="1412" height="2030" rx="80" ry="80"
        fill="none" stroke="white" strokeOpacity="0.82" strokeWidth="5"/>

      {/* ── Inner glow around photo window ── */}
      <rect x="90" y="80"  width="1260" height="1888" rx="76" ry="76"
        fill="none" stroke="white"   strokeOpacity="0.70" strokeWidth="11"/>
      <rect x="83" y="73"  width="1274" height="1902" rx="78" ry="78"
        fill="none" stroke="#8FA2B9" strokeOpacity="0.32" strokeWidth="7"/>

      {/* ── Corner light sweeps (masked to frame ring only) ── */}
      <path d="M28 230L248 28H372L28 360Z"           fill="white"   fillOpacity="0.38" mask={`url(#${kId})`}/>
      <path d="M1412 210L1218 28H1094L1412 352Z"     fill="white"   fillOpacity="0.30" mask={`url(#${kId})`}/>
      <path d="M42 1908L250 2046H378L42 1770Z"       fill="#6F8095" fillOpacity="0.20" mask={`url(#${kId})`}/>
      <path d="M1398 1912L1202 2046H1076L1398 1774Z" fill="white"   fillOpacity="0.26" mask={`url(#${kId})`}/>

      {/* ── Diagonal gloss line ── */}
      <path d="M105 668L1335 1810" stroke="white" strokeOpacity="0.16" strokeWidth="28" mask={`url(#${kId})`}/>

      {/* ── Certification medal badge (sits on frame, overlaps photo edge) ── */}
      <circle cx="1280" cy="980" r="82"  fill="white" fillOpacity="0.92"/>
      <circle cx="1280" cy="980" r="76"  fill={`url(#${dId})`}/>
      <circle cx="1280" cy="980" r="74"  fill="none" stroke="white" strokeOpacity="0.80" strokeWidth="3"/>
      {/* Chevron / check mark */}
      <path d="M1248 948 L1280 1014 L1312 948"
        stroke="#4E5968" strokeWidth="20" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
    </svg>
  )
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

  const isDiamond    = tier === 'diamond'
  const useAssetFrame = isDiamond && assetFrame

  if (useAssetFrame) {
    return (
      <div
        className={cn('relative', fill && 'h-full w-full', className)}
        style={{ borderRadius: radius }}
      >
        {/* Aspect-ratio spacer — matches SVG viewBox 1440 : 2048 = 1 : 1.42222 */}
        <div aria-hidden className="w-full" style={{ paddingBottom: '142.222%' }} />

        {/* Photo window — z-0, behind the SVG frame */}
        <div
          className="absolute z-0 overflow-hidden"
          style={{
            top:    '4.296875%',
            right:  '6.666667%',
            bottom: '4.296875%',
            left:   '6.666667%',
            borderRadius: '1.55rem',
            boxShadow: 'inset 0 0 18px rgba(0,0,0,0.08)',
          }}
        >
          {children}
        </div>

        {/* Diamond frame SVG — always above photo */}
        <DiamondFrame />
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
