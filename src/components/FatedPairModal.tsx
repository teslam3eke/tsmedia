import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import {
  Crown,
  Gem,
  Heart,
  Sparkles,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { playInAppSound } from '@/lib/appSounds'
import { goldenStars } from '@/lib/mbtiCompat'
import { normalizeMbtiTypeForDisplay } from '@/lib/mbti'
import { resolvePhotoUrls } from '@/lib/db'
import { isDisplayablePhotoUrl } from '@/lib/discoverDeckProfilePhotos'
import { ensureConnectionWithBudget } from '@/lib/supabase'
import { profilePhotoPrivacyBlurFilter } from '@/lib/profilePhotoPrivacyBlur'
import {
  preventProfilePhotoContextMenu,
  profilePhotoPrivacyGuardClass,
} from '@/components/ProfilePhotoPrivacyImage'
import type { FatedPairKind, FatedPairPartnerProfile, FatedPairSlotState } from '@/lib/db'

const INTRO_AUTO_MS = 2800
const FATE_RING_R = 28
/** 天選緣分共鳴 UI 下限（golden_score 9→90%、10→100%） */
const HEAVEN_MIN_RESONANCE_PERCENT = 90

type FatedPairCopyBlock = {
  introEyebrow: string
  introTitle: string
  introLead: string
  ribbonTitle: string
  ribbonSub: string
  statusTag: string
  meterLabel: string
  detailHeading: string
  detailBlurb: string
}

const FATED_PAIR_COPY: Record<FatedPairKind, FatedPairCopyBlock> = {
  heaven: {
    introEyebrow: 'Friday Edit · 週五限定',
    introTitle: '天選之人',
    introLead: '在萬人之中，今夜只為你留一席名字。',
    ribbonTitle: '天選之人',
    ribbonSub: '本週精選',
    statusTag: '週五限定嚴選',
    meterLabel: '緣分共鳴',
    detailHeading: '關於天選之人',
    detailBlurb:
      '每週五才會現身的一次際遇。你們在特質上擁有完美的匹配，千年一遇的巧合。',
  },
  earth: {
    introEyebrow: 'Thursday Edit · 週四限定',
    introTitle: '地選之人',
    introLead: '與你看似迥異的輪廓，週四夜裡悄然現身。',
    ribbonTitle: '地選之人',
    ribbonSub: '本週精選',
    statusTag: '週四限定嚴選',
    meterLabel: '緣分共鳴',
    detailHeading: '關於地選之人',
    detailBlurb:
      '天選之人的相對，你們擁有截然不同的特質。在傳統定義上為不合，但在現今社會中有可能成為互補。',
  },
}

function aiMatchPercent(kind: FatedPairKind, slot: FatedPairSlotState): number {
  if (kind === 'heaven') {
    const raw = (slot.golden_score ?? 0) * 10
    return Math.min(100, Math.max(HEAVEN_MIN_RESONANCE_PERCENT, raw))
  }
  return Math.max(8, 100 - (slot.challenge_score ?? 0) * 10)
}

function compatLabel(stars: number, isHeaven: boolean): string {
  if (!isHeaven) return '罕見際遇'
  if (stars >= 5) return '超高契合度'
  if (stars >= 4) return '極高契合度'
  if (stars >= 3) return '高度契合度'
  return '難得際遇'
}

function displayName(p: FatedPairPartnerProfile): string {
  return (p.nickname ?? p.name ?? '匿名').trim() || '匿名'
}

function photoPaths(p: FatedPairPartnerProfile): string[] {
  return (p.photo_urls ?? []).map((x) => String(x ?? '').trim()).filter(Boolean)
}

function quoteBio(bio: string | null | undefined): string | null {
  const text = (bio ?? '').trim()
  if (!text) return null
  if (text.startsWith('「') && text.endsWith('」')) return text
  return `「${text}」`
}

function FateResonanceRing({ percent, ringId }: { percent: number; ringId: string }) {
  const circumference = 2 * Math.PI * FATE_RING_R
  const offset = circumference - (percent / 100) * circumference

  return (
    <div className="relative h-[4rem] w-[4rem] shrink-0 sm:h-[4.5rem] sm:w-[4.5rem]">
      <svg
        viewBox="0 0 72 72"
        className="h-full w-full -rotate-90 drop-shadow-[0_0_12px_rgba(236,72,153,0.45)]"
        aria-hidden
      >
        <defs>
          <linearGradient id={`${ringId}-track`} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#f472b6" />
            <stop offset="100%" stopColor="#a855f7" />
          </linearGradient>
        </defs>
        <circle
          cx="36"
          cy="36"
          r={FATE_RING_R}
          fill="none"
          stroke="rgba(255,255,255,0.12)"
          strokeWidth="5"
        />
        <circle
          cx="36"
          cy="36"
          r={FATE_RING_R}
          fill="none"
          stroke={`url(#${ringId}-track)`}
          strokeWidth="5"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <Heart className="h-5 w-5 fill-pink-300 text-pink-200 drop-shadow-[0_0_8px_rgba(244,114,182,0.8)]" />
      </div>
    </div>
  )
}

function BokehBackdrop() {
  return (
    <>
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-[#12082a] via-[#1a0b2e] to-[#0f061c]" />
      <div
        className="pointer-events-none absolute inset-0 opacity-80"
        style={{
          backgroundImage:
            'radial-gradient(circle at 18% 12%, rgba(251,191,36,0.22), transparent 28%), radial-gradient(circle at 82% 18%, rgba(168,85,247,0.18), transparent 32%), radial-gradient(circle at 70% 88%, rgba(244,114,182,0.12), transparent 36%)',
        }}
      />
    </>
  )
}

function FatedPairPhoto({
  photoUrl,
  photoLoading,
  partnerName,
  privacyBlurred,
  onPhotoError,
  className,
}: {
  photoUrl: string | null
  photoLoading: boolean
  partnerName: string
  privacyBlurred: boolean
  onPhotoError?: () => void
  className?: string
}) {
  return (
    <div
      className={cn(
        'relative w-full shrink-0 overflow-hidden aspect-[4/5] sm:max-h-[20.5rem]',
        className,
      )}
      onContextMenu={privacyBlurred ? preventProfilePhotoContextMenu : undefined}
    >
      {photoUrl ? (
        <img
          src={photoUrl}
          alt=""
          className={cn(
            profilePhotoPrivacyGuardClass,
            'absolute inset-0 h-full w-full object-cover object-[center_22%]',
            privacyBlurred && 'scale-[1.02]',
          )}
          style={privacyBlurred ? { filter: profilePhotoPrivacyBlurFilter() } : undefined}
          decoding="async"
          draggable={false}
          onContextMenu={privacyBlurred ? preventProfilePhotoContextMenu : undefined}
          onError={onPhotoError}
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center bg-[#241047]">
          {photoLoading ? (
            <div className="h-10 w-10 animate-pulse rounded-full bg-white/15" />
          ) : (
            <span className="text-4xl font-light tracking-[0.2em] text-violet-300/50">
              {partnerName.slice(0, 1)}
            </span>
          )}
        </div>
      )}

      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-[#1a0b2e]/20 via-transparent to-transparent" />
    </div>
  )
}

function FatedPairAboutBlurb({ heading, blurb }: { heading: string; blurb: string }) {
  return (
    <div className="mt-2.5 rounded-xl border border-white/10 bg-white/[0.05] px-3.5 py-3 backdrop-blur-sm sm:mt-3">
      <p className="text-[10px] font-semibold tracking-[0.12em] text-amber-200/75">{heading}</p>
      <p className="mt-1.5 text-[12px] leading-relaxed text-white/50 sm:text-[13px]">{blurb}</p>
    </div>
  )
}

function FateResonanceCard({
  copy,
  matchPercent,
  ringId,
  displayStars,
  starLabel,
}: {
  copy: FatedPairCopyBlock
  matchPercent: number
  ringId: string
  displayStars: number
  starLabel: string
}) {
  return (
    <div className="relative overflow-hidden rounded-[1.25rem] border border-fuchsia-400/35 bg-[#1a0b2e]/72 p-3.5 shadow-[0_0_28px_rgba(168,85,247,0.18)] backdrop-blur-md sm:rounded-[1.35rem] sm:bg-white/[0.05] sm:p-4">
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-fuchsia-500/10 via-transparent to-violet-500/10" />
      <div className="relative flex items-center gap-2.5 sm:gap-3">
        <FateResonanceRing percent={matchPercent} ringId={ringId} />
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-semibold tracking-[0.12em] text-white/55 sm:text-[11px] sm:tracking-[0.14em]">
            {copy.meterLabel}
          </p>
          <p className="mt-0.5 text-[1.65rem] font-black leading-none tracking-tight text-white sm:text-[2rem]">
            {matchPercent}
            <span className="ml-0.5 text-base font-bold text-white/45 sm:text-lg">%</span>
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-amber-300 text-xs tracking-[0.1em] sm:text-sm sm:tracking-[0.12em]">
            {'★'.repeat(displayStars)}
            {displayStars < 5 ? (
              <span className="text-white/15">{'★'.repeat(5 - displayStars)}</span>
            ) : null}
          </p>
          <p className="mt-0.5 text-[10px] font-medium text-white/45 sm:mt-1 sm:text-[11px]">{starLabel}</p>
        </div>
      </div>
      <div className="relative mt-2.5 h-1.5 overflow-hidden rounded-full bg-white/10 sm:mt-3">
        <div
          className="h-full rounded-full bg-gradient-to-r from-pink-400 via-fuchsia-400 to-violet-500 shadow-[0_0_10px_rgba(236,72,153,0.45)]"
          style={{ width: `${matchPercent}%` }}
        />
      </div>
    </div>
  )
}

function RibbonBadge({ title, sub }: { title: string; sub: string }) {
  return (
    <div className="absolute left-0 top-0 z-20 flex w-[3.75rem] flex-col items-center rounded-br-[1.5rem] bg-gradient-to-b from-violet-600/95 via-purple-800/95 to-[#2a1147]/95 pb-3 pt-2.5 shadow-[0_10px_30px_rgba(0,0,0,0.35)] ring-1 ring-inset ring-amber-300/35">
      <Gem className="h-3 w-3 text-amber-300 drop-shadow-[0_0_6px_rgba(251,191,36,0.65)]" />
      <p className="mt-1.5 [writing-mode:vertical-rl] text-[13px] font-bold tracking-[0.34em] text-white">
        {title}
      </p>
      <p className="mt-1.5 text-[8px] font-semibold tracking-[0.14em] text-amber-200/85">{sub}</p>
    </div>
  )
}

export default function FatedPairModal({
  open,
  kind,
  slot,
  heartBalance,
  onCloseToday,
  onAccept,
  accepting,
  acceptError,
}: {
  open: boolean
  kind: FatedPairKind
  slot: FatedPairSlotState
  heartBalance: number
  onCloseToday: () => void | Promise<void>
  onAccept: () => void | Promise<void>
  accepting?: boolean
  acceptError?: string | null
}) {
  const partner = slot.partner
  const isHeaven = kind === 'heaven'
  const heartCost = isHeaven ? 3 : 1
  const mbti = normalizeMbtiTypeForDisplay(partner.mbti_type)
  const stars = isHeaven ? goldenStars(slot.golden_score ?? 0) : 0
  const matchPercent = aiMatchPercent(kind, slot)
  const ringId = useMemo(
    () => `fate-ring-${kind}-${slot.partner_user_id.slice(0, 8)}`,
    [kind, slot.partner_user_id],
  )
  const [photoCandidates, setPhotoCandidates] = useState<string[]>([])
  const [photoIdx, setPhotoIdx] = useState(0)
  const [photoLoading, setPhotoLoading] = useState(false)
  const photoUrl = photoCandidates[photoIdx] ?? null
  const [phase, setPhase] = useState<'intro' | 'detail'>('intro')
  const introTimerRef = useRef<number | undefined>(undefined)

  const skipIntro = useCallback(() => {
    if (introTimerRef.current !== undefined) {
      window.clearTimeout(introTimerRef.current)
      introTimerRef.current = undefined
    }
    setPhase('detail')
  }, [])

  useEffect(() => {
    if (!open) {
      setPhase('intro')
      if (introTimerRef.current !== undefined) {
        window.clearTimeout(introTimerRef.current)
        introTimerRef.current = undefined
      }
      return
    }
    setPhase('intro')
    playInAppSound('match')
    introTimerRef.current = window.setTimeout(() => {
      introTimerRef.current = undefined
      setPhase('detail')
    }, INTRO_AUTO_MS)
    return () => {
      if (introTimerRef.current !== undefined) {
        window.clearTimeout(introTimerRef.current)
        introTimerRef.current = undefined
      }
    }
  }, [open, kind, slot.partner_user_id])

  const interestTags = useMemo(
    () => (partner.interests ?? []).filter(Boolean).slice(0, 3),
    [partner.interests],
  )

  const advancePhotoCandidate = useCallback(() => {
    setPhotoIdx((i) => Math.min(i + 1, photoCandidates.length))
  }, [photoCandidates.length])

  useEffect(() => {
    if (!open) {
      setPhotoCandidates([])
      setPhotoIdx(0)
      setPhotoLoading(false)
      return
    }

    const paths = photoPaths(partner)
    const direct = paths.filter(isDisplayablePhotoUrl)
    if (direct.length > 0) {
      setPhotoCandidates(direct.slice(0, 3))
      setPhotoIdx(0)
      setPhotoLoading(false)
      return
    }
    if (paths.length === 0) {
      setPhotoCandidates([])
      setPhotoIdx(0)
      setPhotoLoading(false)
      return
    }

    let cancelled = false
    setPhotoCandidates([])
    setPhotoIdx(0)
    setPhotoLoading(true)
    void (async () => {
      try {
        await ensureConnectionWithBudget()
        if (cancelled) return
        const urls = await resolvePhotoUrls(paths.slice(0, 3))
        if (cancelled) return
        const displayable = urls.filter(isDisplayablePhotoUrl)
        setPhotoCandidates(displayable)
        setPhotoIdx(0)
      } finally {
        if (!cancelled) setPhotoLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open, partner.id, partner.photo_urls])

  if (!open) return null

  const partnerName = displayName(partner)
  const copy = isHeaven ? FATED_PAIR_COPY.heaven : FATED_PAIR_COPY.earth
  const bioQuote = quoteBio(partner.bio)
  const starLabel = compatLabel(stars, isHeaven)
  const displayStars = isHeaven ? Math.max(stars, 1) : 4

  return createPortal(
    <AnimatePresence mode="wait">
      {phase === 'intro' ? (
        <motion.button
          key="fated-pair-intro"
          type="button"
          aria-label={isHeaven ? '天選之人登場' : '地選之人登場'}
          className="fixed inset-0 z-[120] flex items-center justify-center px-5"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.35 }}
          onClick={skipIntro}
        >
          <BokehBackdrop />
          <div className="pointer-events-none absolute inset-0 backdrop-blur-[2px]" />

          <motion.div
            initial={{ scale: 0.88, y: 36, opacity: 0 }}
            animate={{ scale: 1, y: 0, opacity: 1 }}
            exit={{ scale: 0.94, y: 16, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 360, damping: 30 }}
            className="relative z-10 flex w-full max-w-[20rem] flex-col items-center rounded-[2rem] border border-white/10 bg-white/[0.06] px-6 pb-8 pt-10 shadow-2xl shadow-black/50 backdrop-blur-xl"
          >
            <motion.div
              animate={{ rotate: [0, -5, 5, -3, 3, 0] }}
              transition={{ duration: 1.2, ease: 'easeInOut' }}
              className="relative mb-5 inline-flex rounded-full bg-gradient-to-br from-pink-400 via-fuchsia-500 to-violet-600 p-[3px] shadow-[0_0_24px_rgba(168,85,247,0.45)]"
            >
              {[0, 1].map((i) => (
                <motion.div
                  key={i}
                  className="pointer-events-none absolute left-1/2 top-1/2 h-36 w-36 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/20"
                  initial={{ opacity: 0.35, scale: 1 }}
                  animate={{ opacity: [0.35, 0], scale: [1, 1.45] }}
                  transition={{ duration: 2.2, repeat: Infinity, delay: i * 1.1, ease: 'easeOut' }}
                />
              ))}
              <div className="relative flex h-36 w-36 items-center justify-center overflow-hidden rounded-full bg-[#1a0b2e] ring-2 ring-white/15">
                {photoUrl ? (
                  <img
                    src={photoUrl}
                    alt=""
                    className={cn(
                      profilePhotoPrivacyGuardClass,
                      'h-full w-full scale-110 object-cover',
                    )}
                    style={{ filter: profilePhotoPrivacyBlurFilter() }}
                    decoding="async"
                    draggable={false}
                    onContextMenu={preventProfilePhotoContextMenu}
                    onError={advancePhotoCandidate}
                  />
                ) : photoLoading ? (
                  <div className="h-10 w-10 animate-pulse rounded-full bg-white/15" />
                ) : (
                  <Sparkles className="h-12 w-12 text-amber-200/85" />
                )}
              </div>
            </motion.div>

            <p className="text-[11px] font-bold uppercase tracking-[0.28em] text-amber-200/85">
              {copy.introEyebrow}
            </p>
            <h2 className="mt-3 bg-gradient-to-r from-amber-100 via-pink-100 to-violet-100 bg-clip-text text-center text-[30px] font-black tracking-[0.1em] text-transparent">
              {copy.introTitle}
            </h2>
            <p className="mt-2 text-center text-sm font-semibold text-white/90">{partnerName}</p>
            <p className="mt-3 max-w-[16rem] text-center text-xs leading-relaxed text-white/55">
              {copy.introLead}
            </p>

            <div className="relative mt-8 h-1 w-full max-w-[12rem] overflow-hidden rounded-full bg-white/10">
              <motion.div
                className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-pink-400 via-fuchsia-400 to-violet-500"
                initial={{ width: '0%' }}
                animate={{ width: '100%' }}
                transition={{ duration: INTRO_AUTO_MS / 1000, ease: 'linear' }}
              />
            </div>
            <p className="mt-3 text-[11px] font-medium text-white/40">輕觸可略過</p>
          </motion.div>
        </motion.button>
      ) : (
        <motion.div
          key="fated-pair-detail"
          className="fixed inset-0 z-[120] isolate flex items-center justify-center px-3 pt-[max(0.75rem,env(safe-area-inset-top))] pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <div className="pointer-events-none absolute inset-0 bg-black/55 backdrop-blur-md" aria-hidden />

          <motion.article
            role="dialog"
            aria-modal="true"
            aria-labelledby="fated-pair-title"
            className={cn(
              'relative z-[121] flex w-full max-w-[22rem] flex-col overflow-hidden',
              'rounded-[1.85rem] shadow-[0_28px_90px_rgba(0,0,0,0.55)]',
              'max-h-[min(92dvh,calc(100dvh-env(safe-area-inset-top)-env(safe-area-inset-bottom)-1.5rem))]',
              'ring-1 ring-white/10',
            )}
            initial={{ scale: 0.94, y: 24, opacity: 0 }}
            animate={{ scale: 1, y: 0, opacity: 1 }}
            exit={{ scale: 0.96, y: 16, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 380, damping: 34 }}
          >
            <BokehBackdrop />

            <div className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain">
              <div className="relative sm:pb-1">
                <FatedPairPhoto
                  photoUrl={photoUrl}
                  photoLoading={photoLoading}
                  partnerName={partnerName}
                  privacyBlurred
                  onPhotoError={advancePhotoCandidate}
                />

                <RibbonBadge title={copy.ribbonTitle} sub={copy.ribbonSub} />

                <div className="absolute right-3 top-3 z-20 sm:right-4 sm:top-4">
                  <div className="flex items-center gap-1.5 rounded-full border border-amber-300/45 bg-black/25 px-2.5 py-1 text-amber-100/95 shadow-lg backdrop-blur-md sm:px-3 sm:py-1.5">
                    <Crown className="h-3 w-3 text-amber-300 sm:h-3.5 sm:w-3.5" />
                    <span className="text-[10px] font-semibold tracking-[0.06em] sm:text-[11px] sm:tracking-[0.08em]">
                      Friday Edit
                    </span>
                  </div>
                </div>

                {/* 手機：資訊疊在照片上；電腦：照片下方正常排版 */}
                <div className="pointer-events-none absolute inset-x-0 bottom-0 top-[24%] z-[1] bg-gradient-to-b from-transparent via-[#1a0b2e]/72 to-[#1a0b2e] sm:hidden" />
                <div className="pointer-events-none absolute inset-x-0 bottom-0 hidden h-20 bg-gradient-to-t from-[#1a0b2e] to-transparent sm:block" />

                <div className="relative z-10 -mt-[12.5rem] px-4 pb-2 sm:mt-0 sm:px-5 sm:pb-3 sm:pt-2">
                  <div className="inline-flex rounded-full border border-amber-300/35 bg-amber-400/15 px-3 py-1">
                    <span className="text-[11px] font-semibold tracking-[0.08em] text-amber-100">
                      {copy.statusTag}
                    </span>
                  </div>

                  <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 sm:mt-2.5">
                    <h2
                      id="fated-pair-title"
                      className="text-[1.5rem] font-bold tracking-tight text-white sm:text-[1.65rem]"
                    >
                      {partnerName}
                    </h2>
                    {mbti ? (
                      <span className="rounded-lg border border-amber-200/25 bg-[#f5ead8]/90 px-2 py-0.5 text-sm font-black tracking-wide text-[#5c4a32]">
                        {mbti}
                      </span>
                    ) : null}
                    {partner.age ? (
                      <span className="text-sm font-medium text-white/55">{partner.age} 歲</span>
                    ) : null}
                  </div>

                  {bioQuote ? (
                    <p className="mt-1.5 line-clamp-2 text-[13px] leading-relaxed text-white/45 sm:mt-2 sm:text-[14px]">
                      {bioQuote}
                    </p>
                  ) : null}

                  <FatedPairAboutBlurb heading={copy.detailHeading} blurb={copy.detailBlurb} />

                  <div className="mt-2.5 sm:mt-3">
                    <FateResonanceCard
                      copy={copy}
                      matchPercent={matchPercent}
                      ringId={ringId}
                      displayStars={displayStars}
                      starLabel={starLabel}
                    />
                  </div>

                  {interestTags.length > 0 && (
                    <div className="mt-2.5 flex flex-wrap gap-1.5 sm:mt-3 sm:gap-2">
                      {interestTags.map((tag) => (
                        <span
                          key={tag}
                          className="rounded-full border border-white/10 bg-white/[0.06] px-2.5 py-1 text-[10px] font-medium text-white/72 backdrop-blur-sm sm:px-3 sm:py-1.5 sm:text-[11px]"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}

                  {acceptError && (
                    <p className="mt-3 rounded-xl border border-rose-400/25 bg-rose-500/10 px-3 py-2 text-sm text-rose-100">
                      {acceptError}
                    </p>
                  )}
                </div>
              </div>
            </div>

            <div className="relative shrink-0 border-t border-white/10 bg-[#12082a]/95 px-4 py-3.5 pb-[max(0.85rem,env(safe-area-inset-bottom))] backdrop-blur-md sm:px-5 sm:py-4">
              <button
                type="button"
                disabled={accepting || heartBalance < heartCost}
                className={cn(
                  'flex w-full items-center justify-between gap-3 rounded-full px-4 py-3.5 text-[15px] font-bold text-white shadow-[0_10px_30px_rgba(236,72,153,0.35)] transition',
                  'bg-gradient-to-r from-orange-400 via-pink-500 to-fuchsia-600',
                  'hover:from-orange-300 hover:via-pink-400 hover:to-fuchsia-500',
                  'disabled:from-white/15 disabled:via-white/15 disabled:to-white/15 disabled:text-white/35 disabled:shadow-none',
                )}
                onClick={() => void onAccept()}
              >
                <span className="flex items-center gap-2">
                  <Heart className="h-4 w-4 fill-current" />
                  {accepting ? '送出中…' : `送出愛心 · ${heartCost}`}
                </span>
                <span className="rounded-full bg-black/30 px-3 py-1 text-sm font-semibold tabular-nums text-white/90">
                  {heartBalance} ♡
                </span>
              </button>

              <button
                type="button"
                className="mt-2.5 w-full py-2 text-sm font-medium text-white/40 transition hover:text-white/70 sm:mt-3"
                onClick={() => void onCloseToday()}
              >
                今日略過
              </button>
            </div>
          </motion.article>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  )
}
