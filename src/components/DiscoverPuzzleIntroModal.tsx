import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { ChevronLeft, Plus, Send, Smile, Sparkles } from 'lucide-react'
import { cn } from '@/lib/utils'
import { getPuzzleTilePath } from '@/lib/puzzleGeometry'

/** 固定總長 10 s：關閉與對話／解鎖事件對齊（含最後留白看完整照片） */
const TOTAL_INTRO_MS = 10_000
/** 五輪「對方一句 → 你一句」；對應每一輪解鎖：3 + 3 + 3 + 3 + 4 = 16 */
const ROUND_COUNT = 5 as const
const UNLOCK_AFTER_ROUND = [3, 3, 3, 3, 4] as const
const ROUND_SLOT_MS = Math.floor(TOTAL_INTRO_MS / ROUND_COUNT)
/** 輪內節奏（整段對齊 10 s）：對方冒泡 → 你回覆 → 解鎖 */
const ROUND_LEAD_MS = 40
const PEER_TO_ME_MS = 500
const ME_TO_UNLOCK_MS = 440

/** 對齊 {@link PuzzlePhotoUnlock}：單張圖格子拆片順序 */
const TILE_UNLOCK_SEQUENCE = [5, 6, 9, 10, 1, 2, 4, 7, 8, 11, 13, 14, 0, 3, 12, 15] as const

const PUZZLE_TILES = Array.from({ length: 16 }, (_, i) => i)

/** 五輪對話（男性視角對方為女性） */
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

/** 對方為男性（敬稱為主）；輪數與上表一致 */
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

/** 與 MainScreen DEMO 同性別／異性對照的名片資料對齊 */
const PEER_PREVIEW_BY_VIEWER_GENDER = {
  male: {
    name: '王雅婷',
    initials: '王',
    from: '#7c3aed',
    to: '#6d28d9',
    photoUrl: 'https://images.unsplash.com/photo-1773216282433-1d79669534c6?w=640&h=800&fit=crop&q=85',
    scriptPairs: DEMO_CHAT_PAIRS,
  },
  female: {
    name: '劉承恩',
    initials: '劉',
    from: '#0f766e',
    to: '#0d9488',
    photoUrl: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=600&h=900&fit=crop&q=80',
    scriptPairs: DEMO_CHAT_PAIRS_MALE_PEER,
  },
} as const

type Props = {
  open: boolean
  viewerGender: 'male' | 'female'
  /** 固定 10 秒播畢後自動關閉；無手動略過 */
  onComplete: () => void
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

/**
 * 首次進入探索：版型同配對聊天室；對方一句、你一句輪流出現後拼圖才進度；
 * 示範為前四輪各 +3、最後一輪 +4（合 16），整段 **剛好 10 秒**。
 */
export default function DiscoverPuzzleIntroModal({
  open,
  viewerGender,
  onComplete,
}: Props) {
  const svgId = 'discover-puzzle-intro'
  const peerCfg = PEER_PREVIEW_BY_VIEWER_GENDER[viewerGender]
  const peerPhotoUrl = peerCfg.photoUrl
  const timeline = useMemo(
    () => buildTimeline(peerCfg.scriptPairs, UNLOCK_AFTER_ROUND),
    [peerCfg.scriptPairs],
  )

  const [demoUnlocked, setDemoUnlocked] = useState<Set<number>>(() => new Set())
  const [pulseTile, setPulseTile] = useState<number | null>(null)
  const [unlockBurstLabel, setUnlockBurstLabel] = useState<number | null>(null)
  const [puzzleComplete, setPuzzleComplete] = useState(false)
  const [demoMessages, setDemoMessages] = useState<DemoUiMsg[]>([])

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const onCompleteRef = useRef(onComplete)
  onCompleteRef.current = onComplete

  const orderedTiles = useMemo(
    () => [...PUZZLE_TILES].sort((a, b) => Number(demoUnlocked.has(a)) - Number(demoUnlocked.has(b))),
    [demoUnlocked],
  )

  const unlockedCount = demoUnlocked.size

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [demoMessages])

  useEffect(() => {
    if (!open) return
    setDemoUnlocked(new Set())
    setPulseTile(null)
    setUnlockBurstLabel(null)
    setPuzzleComplete(false)
    setDemoMessages([])

    let cancelled = false
    const timers: ReturnType<typeof window.setTimeout>[] = []
    let msgSerial = 0

    function pickNextTiles(prev: Set<number>, need: number): number[] {
      const add: number[] = []
      for (const ti of TILE_UNLOCK_SEQUENCE) {
        if (!prev.has(ti)) add.push(ti)
        if (add.length >= need) break
      }
      return add
    }

    for (const ev of timeline) {
      timers.push(
        window.setTimeout(() => {
          if (cancelled) return
          if (ev.kind === 'msg-them') {
            msgSerial += 1
            setDemoMessages((p) => [
              ...p,
              { id: `t-${msgSerial}`, from: 'them', text: ev.text },
            ])
            return
          }
          if (ev.kind === 'msg-me') {
            msgSerial += 1
            setDemoMessages((p) => [
              ...p,
              { id: `m-${msgSerial}`, from: 'me', text: ev.text },
            ])
            return
          }
          const add = ev.add
          setDemoUnlocked((prev) => {
            const pick = pickNextTiles(prev, add)
            if (pick.length === 0) return prev
            const lastPulse = pick[pick.length - 1] ?? null
            if (lastPulse != null) {
              setPulseTile(lastPulse)
              window.setTimeout(() => {
                if (!cancelled) setPulseTile(null)
              }, 460)
            }
            setUnlockBurstLabel(pick.length)
            window.setTimeout(() => {
              if (!cancelled) setUnlockBurstLabel(null)
            }, 680)
            return new Set([...prev, ...pick])
          })
        }, ev.at),
      )
    }

    timers.push(
      window.setTimeout(() => {
        if (!cancelled) onCompleteRef.current()
      }, TOTAL_INTRO_MS),
    )

    return () => {
      cancelled = true
      for (const id of timers) window.clearTimeout(id)
    }
  }, [open, timeline])

  useEffect(() => {
    if (!open || puzzleComplete) return
    if (unlockedCount < 16) return
    setPuzzleComplete(true)
  }, [open, unlockedCount, puzzleComplete])

  if (typeof document === 'undefined') return null

  return createPortal(
    <AnimatePresence>
      {open ? (
        <motion.div
          key="discover-puzzle-intro-shell"
          className="fixed inset-0 z-[380] flex justify-center bg-white"
          role="dialog"
          aria-modal="true"
          aria-labelledby="discover-puzzle-intro-title"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
        >
          <motion.div
            className="flex h-[100dvh] w-full max-w-md flex-col overflow-hidden bg-white"
            initial={{ opacity: 0.96, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.28, ease: 'easeOut' }}
          >
            {/* ── ChatRoomView 標頭對齊 ── */}
            <div
              className="flex-shrink-0 border-b border-slate-100 bg-white"
              style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 10px)' }}
            >
              <div className="flex items-center gap-2 px-2 py-1">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-400 opacity-85">
                  <ChevronLeft className="w-5 h-5" aria-hidden />
                </div>
                <div className="min-w-0 flex-1">
                  <p
                    id="discover-puzzle-intro-title"
                    className="truncate text-sm font-black leading-tight text-slate-900"
                  >
                    {peerCfg.name}
                  </p>
                  <p className="truncate text-[10px] font-semibold text-slate-400">配對後聊天示意（訊息驅動解鎖）</p>
                </div>
                <div className="h-8 rounded-full bg-slate-50 px-2.5 text-[11px] font-bold leading-8 text-slate-400">
                  封鎖
                </div>
              </div>

              {/* ── PuzzlePhotoUnlock（鍵盤未開）對齊 ── */}
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

                  <div className="relative h-[238px] w-[150px] shrink-0 overflow-hidden rounded-3xl bg-slate-900 shadow-lg shadow-slate-900/10 ring-1 ring-slate-900/10 sm:w-[158px]">
                    <>
                      {!puzzleComplete ? (
                        <svg className="absolute inset-0 h-full w-full" viewBox="0 0 400 600" preserveAspectRatio="none" aria-hidden>
                          <defs>
                            <filter id={`${svgId}-blur`}>
                              <feGaussianBlur stdDeviation="8" />
                            </filter>
                            {PUZZLE_TILES.map((tile) => (
                              <clipPath key={tile} id={`${svgId}-clip-${tile}`} clipPathUnits="userSpaceOnUse">
                                <path d={getPuzzleTilePath(tile)} />
                              </clipPath>
                            ))}
                          </defs>
                          {orderedTiles.map((tile) => {
                            const isUnlocked = demoUnlocked.has(tile)
                            const tilePath = getPuzzleTilePath(tile)
                            return (
                              <g key={tile}>
                                <g clipPath={`url(#${svgId}-clip-${tile})`}>
                                  <image
                                    href={peerPhotoUrl}
                                    x="0"
                                    y="0"
                                    width="400"
                                    height="600"
                                    preserveAspectRatio="xMidYMid meet"
                                    opacity={isUnlocked ? 1 : 0.26}
                                    filter={isUnlocked ? undefined : `url(#${svgId}-blur)`}
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
                          initial={{ opacity: 0, scale: 1.06 }}
                          animate={{ opacity: 1, scale: 1 }}
                          transition={{ duration: 0.55, ease: 'easeOut' }}
                        />
                      )}
                      <div className="pointer-events-none absolute inset-0 rounded-3xl ring-1 ring-inset ring-white/20" />
                      <AnimatePresence>
                        {!puzzleComplete && unlockBurstLabel !== null && (
                          <motion.div
                            key={unlockBurstLabel + unlockedCount}
                            className="pointer-events-none absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center gap-1 rounded-full bg-white/95 px-3 py-1.5 text-[12px] font-black text-sky-600 shadow-lg shadow-sky-900/20"
                            initial={{ opacity: 0, scale: 0.72, y: 8 }}
                            animate={{ opacity: 1, scale: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.92, y: -10 }}
                            transition={{ duration: 0.28, ease: 'easeOut' }}
                          >
                            <Sparkles className="h-3.5 w-3.5" aria-hidden />
                            解鎖 +{unlockBurstLabel}
                          </motion.div>
                        )}
                      </AnimatePresence>
                      <AnimatePresence>
                        {puzzleComplete && (
                          <motion.div
                            key="completion"
                            className="pointer-events-none absolute inset-0 flex items-center justify-center"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
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
                    </>
                  </div>

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
                        <span className="text-[22px] font-black leading-none tracking-tight text-slate-900">{unlockedCount}</span>
                        <span className="text-[13px] font-bold text-slate-400">/16</span>
                      </motion.p>
                    </div>
                    <p className="border-l-2 border-sky-200/90 pl-2 text-[10px] font-medium leading-relaxed text-slate-500">
                      {puzzleComplete
                        ? '真人門檻以聊天室標示為準（例：再互相幾則）'
                        : '對方一句、你一句輪到你後才會進度（示範壓縮秒數）'}
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* ── 訊息區（對齊 ChatRoom 氣泡；內容由腳本逐句插入）── */}
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
                    <motion.div key={m.id} className="flex justify-end" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
                      <div className="max-w-[72%] rounded-2xl rounded-br-md bg-[#8fe37f] px-3.5 py-2 text-[14px] leading-[1.45] text-slate-900 whitespace-pre-wrap break-words">
                        {m.text}
                      </div>
                    </motion.div>
                  ),
                )}
                <div ref={messagesEndRef} className="h-px w-full shrink-0" aria-hidden />
              </div>
            </div>

            {/* ── 輸入列（對齊 ChatRoomView「有文字可送出」態，僅示意）── */}
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

            <div className="shrink-0 space-y-1 border-t border-slate-100 bg-slate-50/90 px-3 py-2 pb-[max(0.75rem,calc(env(safe-area-inset-bottom)+4px))]">
              <p className="text-center text-[11px] font-bold leading-snug text-slate-700">
                下方<strong className="text-slate-900">對方一句、你一句輪流出現</strong>後上面才會解鎖；
                示範為效率：前四輪各解 <strong className="text-slate-900">3</strong>{' '}
                格、最後一輪解 <strong className="text-slate-900">4</strong>{' '}
                格。整段示範固定 <strong className="text-slate-900">{TOTAL_INTRO_MS / 1000}</strong>{' '}
                秒。
              </p>
              <p className="text-center text-[11px] font-semibold tabular-nums text-slate-400">
                {TOTAL_INTRO_MS / 1000} 秒後自動進入探索
              </p>
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>,
    document.body,
  )
}
