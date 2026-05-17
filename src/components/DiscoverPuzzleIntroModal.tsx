import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { ChevronLeft, Plus, Send, Smile, Sparkles } from 'lucide-react'
import { cn } from '@/lib/utils'
import { getPuzzleTilePath } from '@/lib/puzzleGeometry'

/** 總長 10 秒：末段留白展示完整對方照片 */
const AUTO_CLOSE_MS = 10_000
const INTRO_TAIL_FOR_FULL_MS = 2000
const INITIAL_UNLOCK_DELAY_MS = 450
/** 對齊 {@link PuzzlePhotoUnlock}：解鎖格動線 */
const TILE_UNLOCK_SEQUENCE = [5, 6, 9, 10, 1, 2, 4, 7, 8, 11, 13, 14, 0, 3, 12, 15] as const

/** 第一段等 INITIAL_UNLOCK_DELAY_MS，之後 15 段間隔解完 16 格 */
const BETWEEN_UNLOCK_MS = Math.max(
  220,
  Math.floor(
    (AUTO_CLOSE_MS - INTRO_TAIL_FOR_FULL_MS - INITIAL_UNLOCK_DELAY_MS) /
      Math.max(1, TILE_UNLOCK_SEQUENCE.length - 1),
  ),
)

const PUZZLE_TILES = Array.from({ length: 16 }, (_, i) => i)

/** 與 MainScreen DEMO 同性別／異性對照的名片資料對齊 */
const PEER_PREVIEW_BY_VIEWER_GENDER = {
  male: {
    name: '王雅婷',
    initials: '王',
    from: '#7c3aed',
    to: '#6d28d9',
    photoUrl: 'https://images.unsplash.com/photo-1773216282433-1d79669534c6?w=640&h=800&fit=crop&q=85',
  },
  female: {
    name: '劉承恩',
    initials: '劉',
    from: '#0f766e',
    to: '#0d9488',
    photoUrl: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=600&h=900&fit=crop&q=80',
  },
} as const

type Props = {
  open: boolean
  viewerGender: 'male' | 'female'
  /** 滿檔約 10 秒後自動關閉；無手動略過 */
  onComplete: () => void
}

/**
 * 首次進入探索：以「配對聊天室」同版型示範拼圖動畫，約 10 秒內收尾並呈現對方清晰生活照；
 * 男性示意為女性對象／女性為男性對象。
 */
export default function DiscoverPuzzleIntroModal({
  open,
  viewerGender,
  onComplete,
}: Props) {
  const svgId = 'discover-puzzle-intro'
  const peer = PEER_PREVIEW_BY_VIEWER_GENDER[viewerGender]
  const peerPhotoUrl = peer.photoUrl

  const [demoUnlocked, setDemoUnlocked] = useState<Set<number>>(() => new Set())
  const [pulseTile, setPulseTile] = useState<number | null>(null)
  const [puzzleComplete, setPuzzleComplete] = useState(false)
  const onCompleteRef = useRef(onComplete)
  onCompleteRef.current = onComplete

  const orderedTiles = useMemo(
    () => [...PUZZLE_TILES].sort((a, b) => Number(demoUnlocked.has(a)) - Number(demoUnlocked.has(b))),
    [demoUnlocked],
  )

  const unlockedCount = demoUnlocked.size

  useEffect(() => {
    if (!open) return
    const id = window.setTimeout(() => onCompleteRef.current(), AUTO_CLOSE_MS)
    return () => window.clearTimeout(id)
  }, [open])

  useEffect(() => {
    if (!open) return
    setDemoUnlocked(new Set())
    setPulseTile(null)
    setPuzzleComplete(false)

    let cancelled = false
    let stepIdx = 0
    let timeoutId = 0

    const pulse = (t: number) => {
      setPulseTile(t)
      window.setTimeout(() => {
        if (!cancelled) setPulseTile(null)
      }, 420)
    }

    function schedule(delay: number) {
      timeoutId = window.setTimeout(() => {
        if (cancelled) return
        if (stepIdx < TILE_UNLOCK_SEQUENCE.length) {
          const t = TILE_UNLOCK_SEQUENCE[stepIdx]
          stepIdx += 1
          setDemoUnlocked((prev) => new Set([...prev, t]))
          pulse(t)
          schedule(BETWEEN_UNLOCK_MS)
        }
      }, delay)
    }

    schedule(INITIAL_UNLOCK_DELAY_MS)

    return () => {
      cancelled = true
      if (timeoutId) window.clearTimeout(timeoutId)
    }
  }, [open])

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
                    {peer.name}
                  </p>
                  <p className="truncate text-[10px] font-semibold text-slate-400">配對後聊天示意</p>
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
                        {!puzzleComplete && pulseTile !== null && (
                          <motion.div
                            key={pulseTile}
                            className="pointer-events-none absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center gap-1 rounded-full bg-white/95 px-3 py-1.5 text-[12px] font-black text-sky-600 shadow-lg shadow-sky-900/20"
                            initial={{ opacity: 0, scale: 0.72, y: 8 }}
                            animate={{ opacity: 1, scale: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.92, y: -10 }}
                            transition={{ duration: 0.28, ease: 'easeOut' }}
                          >
                            <Sparkles className="h-3.5 w-3.5" aria-hidden />
                            解鎖 +1
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
                        {peer.name} 的拼圖
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
                        ? '真人聊天裡要等雙方都傳過訊息、累積到門檻才會多出格數'
                        : '真實聊天：雙方互傳訊息達門檻才會一片片解鎖'}
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* ── 訊息區（對齊 ChatRoom 氣泡規格）── */}
            <div className="min-h-0 flex-1 overflow-y-auto bg-slate-50/70 px-3 py-2" style={{ WebkitOverflowScrolling: 'touch' }}>
              <div className="flex min-h-[5.5rem] flex-col justify-end gap-3 pb-1">
                <div className="flex items-end gap-2 justify-start">
                  <div
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[12px] font-bold text-white"
                    style={{ background: `linear-gradient(135deg, ${peer.from}, ${peer.to})` }}
                    aria-hidden
                  >
                    {peer.initials}
                  </div>
                  <div className="flex max-w-[72%] flex-col gap-1">
                    <p className="px-1 text-[11px] text-slate-500">{peer.name}</p>
                    <div className="rounded-2xl rounded-bl-md border border-transparent bg-slate-100 px-3.5 py-2 text-[14px] leading-[1.45] text-slate-900 shadow-sm ring-1 ring-slate-200/55">
                      這裡的拼圖要<strong className="font-black">對方也跟著回話</strong>才會一片片開哦——不是光看畫面就會自動解鎖。
                    </div>
                  </div>
                </div>
                <div className="flex justify-end">
                  <div className="max-w-[72%] rounded-2xl rounded-br-md bg-[#8fe37f] px-3.5 py-2 text-[14px] leading-[1.45] text-slate-900 whitespace-pre-wrap break-words">
                    瞭解——所以<strong className="font-black">兩個人都要有傳訊</strong>，上面格數才會跟著長。
                  </div>
                </div>
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
                實際解鎖需<strong className="text-slate-900">雙方在聊天室互傳訊息</strong>並達成「互相幾則」的門檻；這裡為加速示範的動畫。
              </p>
              <p className="text-center text-[11px] font-semibold tabular-nums text-slate-400">
                {AUTO_CLOSE_MS / 1000} 秒後自動進入探索
              </p>
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>,
    document.body,
  )
}
