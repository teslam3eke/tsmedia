import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ChevronLeft, Plus, Send, Smile, Sparkles } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  DISCOVER_DEMO_PEER_FEMALE_PHOTO_URL,
  DISCOVER_DEMO_PEER_MALE_PHOTO_URL,
} from '@/lib/discoverDemoPhotoUrls'
import { getPuzzleTilePath } from '@/lib/puzzleGeometry'
import { PROFILE_PHOTO_PRIVACY_SVG_BLUR_STD } from '@/lib/profilePhotoPrivacyBlur'
import { pickPuzzleTilesLocalBatch } from '@/lib/puzzleUnlockPick'

/** 對話／解鎖腳本總長（前半段）；完成後另停頓 {@link POST_COMPLETE_PAUSE_MS} 再接確認鈕 */
const SCRIPT_TOTAL_MS = 6_850
/** 拼圖全開後留白，再放行 CTA */
const POST_COMPLETE_PAUSE_MS = 2_000
const LOOP_RESTART_MS = 2_400
/** 五輪「對方一句 → 你一句」；對應每一輪解鎖：3 + 3 + 3 + 3 + 4 = 16 */
const ROUND_COUNT = 5 as const
const UNLOCK_AFTER_ROUND = [3, 3, 3, 3, 4] as const
const ROUND_SLOT_MS = Math.floor(SCRIPT_TOTAL_MS / ROUND_COUNT)
const ROUND_LEAD_MS = 32
const PEER_TO_ME_MS = 400
const ME_TO_UNLOCK_MS = 330

const PUZZLE_TILES = Array.from({ length: 16 }, (_, i) => i)

const DEMO_CHAT_PAIRS = [
  {
    peer: '嗨，滑到妳了，覺得我們對週末的想像滿相近的。',
    me: '真的嗎？妳會把行程排滿，還是故意留一片空白？',
  },
  {
    peer: '我會留一整天不排行事曆，不然會被自己追著跑。',
    me: '同感，這樣回血比較快。',
  },
  {
    peer: '那妳最近有出門走走嗎？還是比較想宅在家？',
    me: '有啊，繞個公園走一走就滿療癒。',
  },
  {
    peer: '太好了。妳對手沖有興趣嗎？我最近很沉迷。',
    me: '超有，只是我拖延症發作一直沒入坑。',
  },
  {
    peer: '沒問題，改天我們來交換豆子清單。',
    me: '一言為定，先記下來了。',
  },
] as const

const DEMO_CHAT_PAIRS_MALE_PEER = [
  {
    peer: '嗨，滑到您了，覺得我們對週末的想像滿相近的。',
    me: '真的嗎？您會把行程排滿，還是故意留一片空白？',
  },
  {
    peer: '我會留一整天不排行事曆，不然會被自己追著跑。',
    me: '同感，這樣回血比較快。',
  },
  {
    peer: '那您最近有出門走走嗎？還是比較想宅在家？',
    me: '有，繞個公園走一走就滿療癒。',
  },
  {
    peer: '太好了。您對手沖有興趣嗎？我最近很沉迷。',
    me: '有興趣，只是我拖延症的關係還沒入坑。',
  },
  {
    peer: '沒問題，改天來交換豆子清單。',
    me: '一言為定，先記下來了。',
  },
] as const

type DemoUiMsg = { id: string; from: 'them' | 'me'; text: string }

const PEER_PREVIEW_BY_VIEWER_GENDER = {
  male: {
    name: '王雅婷',
    initials: '王',
    from: '#7c3aed',
    to: '#6d28d9',
    photoUrl: DISCOVER_DEMO_PEER_FEMALE_PHOTO_URL,
    scriptPairs: DEMO_CHAT_PAIRS,
  },
  female: {
    name: '劉承恩',
    initials: '劉',
    from: '#0f766e',
    to: '#0d9488',
    photoUrl: DISCOVER_DEMO_PEER_MALE_PHOTO_URL,
    scriptPairs: DEMO_CHAT_PAIRS_MALE_PEER,
  },
} as const

export type DiscoverPuzzleIntroDemoProps = {
  active: boolean
  viewerGender: 'male' | 'female'
  svgIdPrefix?: string
  /** landing 內嵌：精簡外距、可 loop */
  embedded?: boolean
  loop?: boolean
  className?: string
  titleId?: string
  onComplete?: () => void
}

type TimelineEv =
  | { at: number; kind: 'msg-them'; text: string }
  | { at: number; kind: 'msg-me'; text: string }
  | { at: number; kind: 'unlock'; add: number }

function buildTimeline(
  pairs: readonly { peer: string; me: string }[],
  unlocks: readonly number[],
): TimelineEv[] {
  const evs: TimelineEv[] = []
  const n = Math.min(pairs.length, unlocks.length, ROUND_COUNT)
  for (let k = 0; k < n; k += 1) {
    const base = ROUND_SLOT_MS * k + ROUND_LEAD_MS
    evs.push({ at: base, kind: 'msg-them', text: pairs[k]!.peer })
    evs.push({ at: base + PEER_TO_ME_MS, kind: 'msg-me', text: pairs[k]!.me })
    evs.push({ at: base + PEER_TO_ME_MS + ME_TO_UNLOCK_MS, kind: 'unlock', add: unlocks[k]! })
  }
  return evs
}

/** 探索首次拼圖示意：對話解鎖拼圖（可內嵌 landing 或 modal 全屏）。 */
export default function DiscoverPuzzleIntroDemo({
  active,
  viewerGender,
  svgIdPrefix = 'discover-puzzle-intro',
  embedded = false,
  loop = false,
  className,
  titleId = 'discover-puzzle-intro-title',
  onComplete,
}: DiscoverPuzzleIntroDemoProps) {
  const peerCfg = PEER_PREVIEW_BY_VIEWER_GENDER[viewerGender]
  const peerPhotoUrl = peerCfg.photoUrl
  const timeline = useMemo(
    () => buildTimeline(peerCfg.scriptPairs, UNLOCK_AFTER_ROUND),
    [peerCfg.scriptPairs],
  )

  const [animationKey, setAnimationKey] = useState(0)
  const [demoUnlocked, setDemoUnlocked] = useState<Set<number>>(() => new Set())
  const [pulseTile, setPulseTile] = useState<number | null>(null)
  const [puzzleComplete, setPuzzleComplete] = useState(false)
  const [showProceedCta, setShowProceedCta] = useState(false)
  const [demoMessages, setDemoMessages] = useState<DemoUiMsg[]>([])
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const orderedTiles = useMemo(
    () => [...PUZZLE_TILES].sort((a, b) => Number(demoUnlocked.has(a)) - Number(demoUnlocked.has(b))),
    [demoUnlocked],
  )

  const unlockedCount = demoUnlocked.size

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [demoMessages])

  useEffect(() => {
    if (!active) return
    setDemoUnlocked(new Set())
    setPulseTile(null)
    setShowProceedCta(false)
    setPuzzleComplete(false)
    setDemoMessages([])

    let cancelled = false
    const timers: number[] = []
    let msgSerial = 0
    let unlockBatch = 0

    for (const ev of timeline) {
      timers.push(
        window.setTimeout(() => {
          if (cancelled) return
          if (ev.kind === 'msg-them') {
            msgSerial += 1
            setDemoMessages((p) => [...p, { id: `t-${msgSerial}`, from: 'them', text: ev.text }])
            return
          }
          if (ev.kind === 'msg-me') {
            msgSerial += 1
            setDemoMessages((p) => [...p, { id: `m-${msgSerial}`, from: 'me', text: ev.text }])
            return
          }
          const add = ev.add
          const batchIndex = unlockBatch
          unlockBatch += 1
          setDemoUnlocked((prev) => {
            const pick = pickPuzzleTilesLocalBatch(prev, add, svgIdPrefix, batchIndex)
            if (pick.length === 0) return prev
            const lastPulse = pick[pick.length - 1] ?? null
            if (lastPulse != null) {
              setPulseTile(lastPulse)
              window.setTimeout(() => {
                if (!cancelled) setPulseTile(null)
              }, 460)
            }
            return new Set([...prev, ...pick])
          })
        }, ev.at),
      )
    }

    return () => {
      cancelled = true
      for (const id of timers) window.clearTimeout(id)
    }
  }, [active, timeline, animationKey, svgIdPrefix])

  useEffect(() => {
    if (!active || puzzleComplete) return
    if (unlockedCount < 16) return
    setPuzzleComplete(true)
  }, [active, unlockedCount, puzzleComplete])

  useEffect(() => {
    if (!active || !puzzleComplete) {
      setShowProceedCta(false)
      return
    }
    if (loop && embedded) {
      setShowProceedCta(false)
      const id = window.setTimeout(() => {
        setAnimationKey((k) => k + 1)
      }, LOOP_RESTART_MS)
      return () => window.clearTimeout(id)
    }
    setShowProceedCta(false)
    const id = window.setTimeout(() => {
      setShowProceedCta(true)
    }, POST_COMPLETE_PAUSE_MS)
    return () => window.clearTimeout(id)
  }, [active, puzzleComplete, loop, embedded])

  return (
    <div
      className={cn(
        'flex flex-col overflow-hidden bg-white',
        embedded ? 'h-full min-h-0' : 'h-[100dvh] w-full max-w-md',
        className,
      )}
    >
      <div
        className="flex-shrink-0 border-b border-slate-100 bg-white"
        style={{ paddingTop: embedded ? '8px' : 'calc(env(safe-area-inset-top, 0px) + 10px)' }}
      >
        <div className="flex items-center gap-2 px-2 py-1">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-400 opacity-85">
            <ChevronLeft className="w-5 h-5" aria-hidden />
          </div>
          <div className="min-w-0 flex-1">
            <p id={titleId} className="truncate text-sm font-black leading-tight text-slate-900">
              {peerCfg.name}
            </p>
            <p className="truncate text-[10px] font-semibold text-slate-400">配對聊天室</p>
          </div>
          <div className="h-8 rounded-full bg-slate-50 px-2.5 text-[11px] font-bold leading-8 text-slate-400">
            封鎖
          </div>
        </div>

        <div className="bg-white px-3 py-2 shadow-sm ring-1 ring-slate-100">
          <div className="flex h-[238px] w-full items-stretch justify-center gap-1 sm:gap-1.5">
            <div className="flex w-[76px] shrink-0 flex-col justify-center sm:w-[82px]">
              <button
                type="button"
                disabled
                className={cn(
                  'w-full cursor-default rounded-2xl px-2 py-3 text-[11px] font-black leading-snug shadow-sm',
                  puzzleComplete ? 'bg-slate-100 text-slate-400' : 'bg-sky-500 text-white shadow-sky-500/30',
                )}
                aria-hidden
              >
                隨機解 1 片
              </button>
            </div>

            <motion.div
              className="relative h-[238px] w-[150px] shrink-0 overflow-hidden rounded-3xl bg-slate-900 shadow-lg shadow-slate-900/10 ring-1 ring-slate-900/10 sm:w-[158px]"
              initial={false}
              animate={
                puzzleComplete
                  ? {
                      boxShadow: [
                        '0 20px 50px rgb(15 23 42 / 0.12)',
                        '0 12px 40px rgb(14 165 233 / 0.35)',
                        '0 20px 45px rgb(15 23 42 / 0.14)',
                      ],
                    }
                  : { boxShadow: '0 20px 50px rgb(15 23 42 / 0.12)' }
              }
              transition={{ duration: 1.05, ease: 'easeOut' }}
            >
              {!puzzleComplete ? (
                <svg className="absolute inset-0 h-full w-full" viewBox="0 0 400 600" preserveAspectRatio="none" aria-hidden>
                  <defs>
                    <filter id={`${svgIdPrefix}-blur`}>
                      <feGaussianBlur stdDeviation={PROFILE_PHOTO_PRIVACY_SVG_BLUR_STD} />
                    </filter>
                    {PUZZLE_TILES.map((tile) => (
                      <clipPath key={tile} id={`${svgIdPrefix}-clip-${tile}`} clipPathUnits="userSpaceOnUse">
                        <path d={getPuzzleTilePath(tile)} />
                      </clipPath>
                    ))}
                  </defs>
                  {orderedTiles.map((tile) => {
                    const isUnlocked = demoUnlocked.has(tile)
                    const tilePath = getPuzzleTilePath(tile)
                    return (
                      <g key={tile}>
                        <g clipPath={`url(#${svgIdPrefix}-clip-${tile})`}>
                          <image
                            href={peerPhotoUrl}
                            x="0"
                            y="0"
                            width="400"
                            height="600"
                            preserveAspectRatio="xMidYMid meet"
                            opacity={isUnlocked ? 1 : 0.26}
                            filter={isUnlocked ? undefined : `url(#${svgIdPrefix}-blur)`}
                          />
                          {!isUnlocked && <path d={tilePath} fill="rgba(15, 23, 42, 0.38)" />}
                        </g>
                        <path d={tilePath} fill="none" stroke="rgba(255,255,255,.42)" strokeWidth="2.2" />
                        {pulseTile === tile && (
                          <motion.path
                            d={tilePath}
                            fill="rgba(255,255,255,.72)"
                            initial={{ opacity: 0.95 }}
                            animate={{ opacity: 0 }}
                            transition={{ duration: 0.8, ease: 'easeOut' }}
                          />
                        )}
                      </g>
                    )
                  })}
                </svg>
              ) : (
                <motion.img
                  src={peerPhotoUrl}
                  alt=""
                  aria-hidden
                  className="absolute inset-0 h-full w-full object-contain object-center"
                  initial={{ opacity: 0, scale: 1.09 }}
                  animate={{ opacity: 1, scale: [1.09, 1, 1.026, 1] }}
                  transition={{ duration: 1.22, ease: 'easeOut' }}
                />
              )}
              <div className="pointer-events-none absolute inset-0 rounded-3xl ring-1 ring-inset ring-white/20" />
              <AnimatePresence>
                {puzzleComplete && !showProceedCta && (
                  <motion.div
                    key="completion-chip"
                    className="pointer-events-none absolute inset-0 flex items-center justify-center"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0, scale: 0.92 }}
                    transition={{ duration: 0.25 }}
                  >
                    <motion.div
                      className="relative flex items-center gap-1.5 rounded-full bg-white/95 px-4 py-2 text-[13px] font-black text-amber-500 shadow-xl shadow-amber-900/20"
                      initial={{ scale: 0.72, y: 12 }}
                      animate={{ scale: [0.72, 1.08, 1], y: 0 }}
                      transition={{ duration: 0.48, ease: 'easeOut' }}
                    >
                      <Sparkles className="h-4 w-4" aria-hidden />
                      拼圖完成
                    </motion.div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>

            <div className="flex min-w-0 max-w-[118px] flex-1 basis-0 flex-col justify-center gap-2.5 pl-0.5 sm:max-w-[124px]">
              <div className="space-y-1">
                <p className="truncate text-[11px] font-black leading-tight text-slate-900">
                  {peerCfg.name} 的拼圖
                </p>
                <motion.p
                  key={unlockedCount}
                  initial={{ scale: 1.28, color: '#0284c7' }}
                  animate={{ scale: 1, color: '#0f172a' }}
                  transition={{ type: 'spring', stiffness: 400, damping: 18 }}
                  className="flex items-baseline gap-0.5 tabular-nums"
                >
                  <span className="text-[22px] font-black leading-none tracking-tight text-slate-900">
                    {unlockedCount}
                  </span>
                  <span className="text-[13px] font-bold text-slate-400">/16</span>
                </motion.p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div
        className="min-h-0 flex-1 overflow-y-auto bg-slate-50/70 px-3 py-2"
        style={{ WebkitOverflowScrolling: 'touch' }}
      >
        <div className="flex min-h-[5rem] flex-col gap-3 pb-1">
          {demoMessages.map((m) =>
            m.from === 'them' ? (
              <div key={m.id} className="flex items-end gap-2 justify-start">
                <div
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[12px] font-bold text-white"
                  style={{ background: `linear-gradient(135deg, ${peerCfg.from}, ${peerCfg.to})` }}
                  aria-hidden
                >
                  {peerCfg.initials}
                </div>
                <div className="flex max-w-[72%] flex-col gap-1">
                  <p className="px-1 text-[11px] text-slate-500">{peerCfg.name}</p>
                  <div className="rounded-2xl rounded-bl-md border border-transparent bg-slate-100 px-3.5 py-2 text-[14px] leading-[1.45] text-slate-900 shadow-sm ring-1 ring-slate-200/55">
                    {m.text}
                  </div>
                </div>
              </div>
            ) : (
              <motion.div
                key={m.id}
                className="flex justify-end"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
              >
                <div className="max-w-[72%] rounded-2xl rounded-br-md bg-[#8fe37f] px-3.5 py-2 text-[14px] leading-[1.45] text-slate-900 whitespace-pre-wrap break-words">
                  {m.text}
                </div>
              </motion.div>
            ),
          )}
          <div ref={messagesEndRef} className="h-px w-full shrink-0" aria-hidden />
        </div>
      </div>

      <div className="pointer-events-none flex-shrink-0 border-t border-slate-200 bg-white px-2 py-1.5">
        <div className="flex items-center gap-1.5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-slate-500">
            <Plus className="w-5 h-5" aria-hidden />
          </span>
          <div className="flex min-h-[38px] flex-1 items-center rounded-full bg-slate-100 pl-4 pr-1">
            <span className="py-1 text-[15px] text-slate-400">輸入訊息</span>
            <span className="ml-auto flex h-7 w-7 items-center justify-center text-slate-500">
              <Smile className="w-[18px] h-[18px]" aria-hidden />
            </span>
          </div>
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white">
            <Send className="h-4 w-4 text-white" aria-hidden />
          </span>
        </div>
      </div>

      {!embedded ? (
        <div className="shrink-0 border-t border-slate-100 bg-white pb-[max(0.625rem,calc(env(safe-area-inset-bottom)+8px))] pt-2">
          <AnimatePresence>
            {showProceedCta ? (
              <motion.div
                key="intro-cta"
                className="px-4 pb-0.5"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 6 }}
                transition={{ duration: 0.26, ease: 'easeOut' }}
              >
                <button
                  type="button"
                  className="w-full rounded-2xl bg-sky-600 py-3.5 text-[15px] font-black tracking-wide text-white shadow-lg shadow-sky-900/20 transition-transform active:scale-[0.98]"
                  onClick={() => onComplete?.()}
                >
                  開始探索
                </button>
              </motion.div>
            ) : null}
          </AnimatePresence>
        </div>
      ) : null}
    </div>
  )
}
