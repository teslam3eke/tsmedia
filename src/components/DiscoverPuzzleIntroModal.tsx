import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { MessageCircle, Sparkles } from 'lucide-react'
import { cn } from '@/lib/utils'
import { getPuzzleTilePath } from '@/lib/puzzleGeometry'

const AUTO_CLOSE_MS = 3000
const PUZZLE_TILES = Array.from({ length: 16 }, (_, i) => i)

type Props = {
  open: boolean
  /** 約 3 秒後呼叫；不可手動略過 */
  onComplete: () => void
}

/**
 * 首次進入探索：拼圖解鎖教學。
 * 全螢幕層級、約 3 秒後自動關閉；不提供略過。
 */
export default function DiscoverPuzzleIntroModal({ open, onComplete }: Props) {
  const svgId = 'discover-puzzle-intro'
  const [demoUnlocked, setDemoUnlocked] = useState(() => new Set<number>([2, 5, 8]))
  const [pulseTile, setPulseTile] = useState<number | null>(null)
  const [hintIndex, setHintIndex] = useState(0)
  const unlockSeqRef = useRef([11, 14, 1, 13, 6, 10])
  const seqPosRef = useRef(0)
  const onCompleteRef = useRef(onComplete)
  onCompleteRef.current = onComplete

  const orderedTiles = useMemo(
    () => [...PUZZLE_TILES].sort((a, b) => Number(demoUnlocked.has(a)) - Number(demoUnlocked.has(b))),
    [demoUnlocked],
  )

  useEffect(() => {
    if (!open) return
    const id = window.setTimeout(() => onCompleteRef.current(), AUTO_CLOSE_MS)
    return () => window.clearTimeout(id)
  }, [open])

  useEffect(() => {
    if (!open) return
    setDemoUnlocked(new Set([2, 5, 8]))
    setHintIndex(0)
    seqPosRef.current = 0
  }, [open])

  useEffect(() => {
    if (!open) return
    const hintTimer = window.setInterval(() => {
      setHintIndex((i) => (i + 1) % 3)
    }, 3200)
    return () => window.clearInterval(hintTimer)
  }, [open])

  useEffect(() => {
    if (!open) return
    const tick = () => {
      const seq = unlockSeqRef.current
      const pos = seqPosRef.current % seq.length
      const t = seq[pos]!
      seqPosRef.current += 1
      setDemoUnlocked((prev) => {
        const next = new Set(prev)
        if (next.size >= 14) {
          next.clear()
          next.add(2)
          next.add(5)
          next.add(8)
          seqPosRef.current = 0
          return next
        }
        next.add(t)
        return next
      })
      setPulseTile(t)
      window.setTimeout(() => setPulseTile(null), 650)
    }
    const id = window.setInterval(tick, 1650)
    return () => window.clearInterval(id)
  }, [open])

  if (typeof document === 'undefined') return null

  const unlockedCount = demoUnlocked.size

  return createPortal(
    <AnimatePresence>
      {open ? (
        <motion.div
          key="discover-puzzle-intro-backdrop"
          className="fixed inset-0 z-[380] flex min-h-[100dvh] flex-col items-center justify-center bg-slate-950/70 px-4 pt-safe pb-safe sm:p-5"
          role="dialog"
          aria-modal="true"
          aria-labelledby="discover-puzzle-intro-title"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.25 }}
        >
          <motion.div
            className="flex max-h-[min(100dvh-2rem,calc(100dvh-env(safe-area-inset-bottom)-2rem))] w-full max-w-[min(100%,380px)] flex-col overflow-hidden rounded-[1.75rem] bg-white shadow-2xl shadow-slate-900/25 ring-1 ring-slate-200/90"
            initial={{ opacity: 0, y: 20, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 420, damping: 34 }}
          >
            <div className="border-b border-slate-100 bg-gradient-to-br from-sky-50 via-white to-violet-50 px-5 pb-4 pt-6">
              <div className="flex items-center justify-center gap-2">
                <motion.div
                  animate={{ rotate: [0, -8, 8, 0] }}
                  transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}
                  className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-sky-500 to-indigo-600 shadow-lg shadow-sky-600/25"
                >
                  <Sparkles className="h-5 w-5 text-white" aria-hidden />
                </motion.div>
              </div>
              <h2
                id="discover-puzzle-intro-title"
                className="mt-3 text-center text-[1.05rem] font-black tracking-tight text-slate-900"
              >
                聊天拼圖解鎖
              </h2>
              <p className="mt-1.5 text-center text-[11px] font-semibold text-slate-500">
                實際畫面長這樣 — 配對後在訊息裡會看到
              </p>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto bg-white px-4 py-4 shadow-inner shadow-slate-100/80">
              <div className="flex h-[220px] w-full items-stretch justify-center gap-1.5 sm:h-[238px]">
                <div className="flex w-[72px] shrink-0 flex-col justify-center sm:w-[76px]">
                  <motion.div
                    className={cn(
                      'rounded-2xl px-2 py-3 text-center text-[10px] font-black leading-snug shadow-md',
                      'bg-gradient-to-b from-sky-500 to-sky-600 text-white shadow-sky-600/30 ring-1 ring-sky-400/40',
                    )}
                    animate={{ scale: [1, 1.03, 1] }}
                    transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
                  >
                    隨機解 1 片
                  </motion.div>
                  <p className="mt-2 text-center text-[9px] font-semibold leading-tight text-slate-400">
                    道具／訂閱
                  </p>
                </div>

                <motion.div
                  className="relative h-full w-[138px] shrink-0 overflow-hidden rounded-3xl bg-slate-900 shadow-xl shadow-slate-900/20 ring-1 ring-slate-900/15 sm:w-[150px]"
                  initial={{ opacity: 0.85 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.15 }}
                >
                  <svg className="absolute inset-0 h-full w-full" viewBox="0 0 400 600" preserveAspectRatio="none" aria-hidden>
                    <defs>
                      <linearGradient id={`${svgId}-photo`} x1="0%" y1="0%" x2="100%" y2="100%">
                        <stop offset="0%" stopColor="#38bdf8" />
                        <stop offset="45%" stopColor="#818cf8" />
                        <stop offset="100%" stopColor="#c084fc" />
                      </linearGradient>
                      <filter id={`${svgId}-blur`}>
                        <feGaussianBlur stdDeviation="10" />
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
                            <rect width="400" height="600" fill={`url(#${svgId}-photo)`} />
                            {!isUnlocked && (
                              <>
                                <rect width="400" height="600" fill="#0f172a" opacity="0.42" filter={`url(#${svgId}-blur)`} />
                                <path d={tilePath} fill="rgba(15, 23, 42, 0.36)" />
                              </>
                            )}
                          </g>
                          <path d={tilePath} fill="none" stroke="rgba(255,255,255,.38)" strokeWidth="2.2" />
                          {pulseTile === tile && (
                            <motion.path
                              d={tilePath}
                              fill="rgba(56, 189, 248, 0.55)"
                              initial={{ opacity: 0.9 }}
                              animate={{ opacity: 0 }}
                              transition={{ duration: 0.7, ease: 'easeOut' }}
                            />
                          )}
                        </g>
                      )
                    })}
                  </svg>
                  <div className="pointer-events-none absolute inset-0 rounded-3xl ring-1 ring-inset ring-white/15" />

                  <AnimatePresence mode="wait">
                    {pulseTile !== null && (
                      <motion.div
                        key={pulseTile}
                        className="pointer-events-none absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center gap-1 rounded-full bg-white/95 px-2.5 py-1 text-[11px] font-black text-sky-600 shadow-lg shadow-sky-900/20"
                        initial={{ opacity: 0, scale: 0.72, y: 6 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.9, y: -8 }}
                        transition={{ duration: 0.22, ease: 'easeOut' }}
                      >
                        <Sparkles className="h-3 w-3" />
                        解鎖 +1
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>

                <div className="flex min-w-0 flex-1 flex-col justify-center pl-0.5">
                  <p className="truncate text-[11px] font-black text-slate-900">對方暱稱</p>
                  <motion.p
                    key={unlockedCount}
                    initial={{ scale: 1.2, color: '#0284c7' }}
                    animate={{ scale: 1, color: '#0f172a' }}
                    transition={{ type: 'spring', stiffness: 400, damping: 20 }}
                    className="mt-1 tabular-nums text-[15px] font-black text-slate-900"
                  >
                    <span className="text-sky-600">{unlockedCount}</span>
                    <span className="text-slate-400">/16</span>
                  </motion.p>
                  <p className="mt-1 text-[10px] font-semibold leading-snug text-slate-500">
                    再互相 3 則訊息可繼續解鎖
                  </p>
                </div>
              </div>
            </div>

            <div className="relative h-[4.25rem] shrink-0 overflow-hidden border-t border-slate-100 bg-slate-50/90 px-5 py-3">
              <AnimatePresence mode="wait">
                <motion.div
                  key={hintIndex}
                  initial={{ opacity: 0, x: 14 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -14 }}
                  transition={{ duration: 0.22 }}
                  className="flex gap-3 text-left"
                >
                  {hintIndex === 0 && (
                    <>
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white shadow-sm ring-1 ring-slate-100">
                        <MessageCircle className="h-4 w-4 text-sky-600" />
                      </div>
                      <div>
                        <p className="text-[11px] font-bold text-slate-800">照片變成 16 片拼圖</p>
                        <p className="mt-0.5 text-[10px] leading-relaxed text-slate-500">
                          未開的區域會模糊；聊越多、開越多片，輪廓越清晰。
                        </p>
                      </div>
                    </>
                  )}
                  {hintIndex === 1 && (
                    <>
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white shadow-sm ring-1 ring-slate-100">
                        <Sparkles className="h-4 w-4 text-amber-500" />
                      </div>
                      <div>
                        <p className="text-[11px] font-bold text-slate-800">互相傳訊累積進度</p>
                        <p className="mt-0.5 text-[10px] leading-relaxed text-slate-500">
                          同一則對話雙方來回算數；別太快 spam，好好聊更有感。
                        </p>
                      </div>
                    </>
                  )}
                  {hintIndex === 2 && (
                    <>
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white shadow-sm ring-1 ring-slate-100">
                        <Sparkles className="h-4 w-4 text-violet-600" />
                      </div>
                      <div>
                        <p className="text-[11px] font-bold text-slate-800">等不及就用道具</p>
                        <p className="mt-0.5 text-[10px] leading-relaxed text-slate-500">
                          「隨機解 1 片」立刻開一格（依訂閱與餘額）；上方動畫為示意。
                        </p>
                      </div>
                    </>
                  )}
                </motion.div>
              </AnimatePresence>
              <div className="mt-2 flex justify-center gap-1">
                {[0, 1, 2].map((i) => (
                  <div
                    key={i}
                    className={cn(
                      'h-1 rounded-full transition-all',
                      hintIndex === i ? 'w-4 bg-slate-800' : 'w-1 bg-slate-300',
                    )}
                  />
                ))}
              </div>
            </div>

            <p className="shrink-0 border-t border-slate-100 px-5 pb-5 pt-2 text-center text-[11px] font-semibold text-slate-400">
              約 {AUTO_CLOSE_MS / 1000} 秒後自動繼續
            </p>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>,
    document.body,
  )
}
