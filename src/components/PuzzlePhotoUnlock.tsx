import { AnimatePresence, motion } from 'framer-motion'
import { Sparkles } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { PUZZLE_MAX_PHOTO_SLOTS } from '@/lib/types'
import { getPuzzleTilePath } from '@/lib/puzzleGeometry'

export type PuzzleChatMessage = {
  id: string
  text: string
  from: 'me' | 'them'
  time?: string
  date?: string
  read?: boolean
  createdAt?: string
}

export type PuzzleConversation = {
  id: number | string
  name: string
  initials: string
  from: string
  to: string
  photoUrl?: string
  photoUrls?: string[]
  matchedAt?: number
}


export function collectConversationPhotoUrls(c: Pick<PuzzleConversation, 'photoUrls' | 'photoUrl'>): string[] {
  const list = (c.photoUrls ?? []).map((u) => String(u).trim()).filter(Boolean)
  if (list.length > 0) return list
  if (c.photoUrl) return [c.photoUrl]
  return []
}

const RECENT_MATCH_BOOST_MS = 30 * 60 * 1000


const PUZZLE_UNLOCK_ORDER = [5, 6, 9, 10, 1, 2, 4, 7, 8, 11, 13, 14, 0, 3, 12, 15]

function pickOneSpreadPuzzleTileInSlot(occupied: Set<number>, slot: number, rng: () => number): number | null {
  const base = slot * 16
  const occupiedLocal = new Set<number>()
  for (const g of occupied) {
    if (g >= base && g < base + 16) occupiedLocal.add(g - base)
  }
  const pick = pickOneSpreadPuzzleTile(occupiedLocal, rng)
  if (pick === null) return null
  return base + pick
}

function puzzleSlotIsComplete(globalSet: Set<number>, slot: number): boolean {
  const base = slot * 16
  for (let l = 0; l < 16; l += 1) {
    if (!globalSet.has(base + l)) return false
  }
  return true
}

function puzzleCountPerSlot(globalSet: Set<number>, slot: number): number {
  const base = slot * 16
  let n = 0
  for (let l = 0; l < 16; l += 1) {
    if (globalSet.has(base + l)) n += 1
  }
  return n
}

function puzzleTileManhattan(a: number, b: number): number {
  const ra = Math.floor(a / 4)
  const ca = a % 4
  const rb = Math.floor(b / 4)
  const cb = b % 4
  return Math.abs(ra - rb) + Math.abs(ca - cb)
}

function puzzleMinDistToOccupied(tile: number, occupied: Set<number>): number {
  let d = Infinity
  for (const t of occupied) {
    d = Math.min(d, puzzleTileManhattan(tile, t))
  }
  return d
}

/** Prefer tiles far from everything already unlocked; random tie-break so bonus grids vary but stay stable per seed. */
function pickOneSpreadPuzzleTile(occupied: Set<number>, rng: () => number): number | null {
  const candidates: number[] = []
  for (let t = 0; t < 16; t += 1) {
    if (!occupied.has(t)) candidates.push(t)
  }
  if (candidates.length === 0) return null
  let best = -1
  const pool: number[] = []
  for (const t of candidates) {
    const md = puzzleMinDistToOccupied(t, occupied)
    if (md > best) {
      best = md
      pool.length = 0
      pool.push(t)
    } else if (md === best) {
      pool.push(t)
    }
  }
  return pool[Math.floor(rng() * pool.length)] ?? null
}

function puzzleHashSeed(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

function puzzleMulberry32(seed: number): () => number {
  return () => {
    let t = (seed += 0x6d2b79f5)
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function formatPuzzleBoostCountdown(ms: number) {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

export function getPuzzleProgress(
  messages: PuzzleChatMessage[],
  manualUnlockedTiles: number[] = [],
  matchedAt?: number,
  now = Date.now(),
  puzzleSeedKey = '',
  photoSlotCount = PUZZLE_MAX_PHOTO_SLOTS,
  liveUseDbTilesOnly = false,
) {
  const slots = Math.max(1, Math.min(PUZZLE_MAX_PHOTO_SLOTS, photoSlotCount))
  const maxGlobal = slots * 16

  const meCount = messages.filter((message) => message.from === 'me').length
  const themCount = messages.filter((message) => message.from === 'them').length
  const boostRemainingMs = matchedAt ? Math.max(0, RECENT_MATCH_BOOST_MS - (now - matchedAt)) : 0
  const boostActive = boostRemainingMs > 0
  const round = Math.floor(Math.min(meCount, themCount) / 3)
  const mult = boostActive ? 2 : 1
  const chatUnlocks = round * mult

  const rng = puzzleMulberry32(puzzleHashSeed(`${puzzleSeedKey}|puzzle|${matchedAt ?? 0}`))

  let globalSorted: number[]
  const chatTiles: number[] = []

  if (liveUseDbTilesOnly) {
    globalSorted = Array.from(new Set(manualUnlockedTiles.filter((t) => t >= 0 && t < maxGlobal))).sort((a, b) => a - b)
  } else {
    const occupied = new Set<number>(manualUnlockedTiles)
    for (let r = 1; r <= round; r += 1) {
      const slot = Math.floor((r - 1) / 16)
      if (slot >= slots) break
      const idxInSlot = (r - 1) % 16
      const primaryLocal = PUZZLE_UNLOCK_ORDER[idxInSlot]
      const globalPrimary = slot * 16 + primaryLocal
      if (!occupied.has(globalPrimary)) {
        chatTiles.push(globalPrimary)
        occupied.add(globalPrimary)
      } else {
        const fallback = pickOneSpreadPuzzleTileInSlot(occupied, slot, rng)
        if (fallback !== null) {
          chatTiles.push(fallback)
          occupied.add(fallback)
        }
      }
      if (mult === 2) {
        const spread = pickOneSpreadPuzzleTileInSlot(occupied, slot, rng)
        if (spread !== null) {
          chatTiles.push(spread)
          occupied.add(spread)
        }
      }
    }
    globalSorted = Array.from(new Set([...chatTiles, ...manualUnlockedTiles]))
      .filter((t) => t >= 0 && t < maxGlobal)
      .sort((a, b) => a - b)
  }

  const globalSet = new Set(globalSorted)
  let allPhotosComplete = true
  let activePhotoIndex = 0
  for (let s = 0; s < slots; s += 1) {
    if (!puzzleSlotIsComplete(globalSet, s)) {
      allPhotosComplete = false
      activePhotoIndex = s
      break
    }
  }
  if (allPhotosComplete && slots > 0) {
    activePhotoIndex = slots - 1
  }

  const unlockedTiles = globalSorted
    .filter((g) => Math.floor(g / 16) === activePhotoIndex)
    .map((g) => g % 16)
  const unlockedCount = unlockedTiles.length
  const nextRemaining =
    allPhotosComplete ? 0 : Math.max(0, 3 - (Math.min(meCount, themCount) % 3))

  return {
    meCount,
    themCount,
    chatUnlocks,
    unlockedCount,
    unlockedTiles,
    globalUnlockedTiles: globalSorted,
    nextRemaining,
    boostActive,
    boostRemainingMs,
    activePhotoIndex,
    photoSlotCount: slots,
    allPhotosComplete,
  }
}

export function PuzzlePhotoUnlock({
  conversation,
  messages,
  manualUnlockedTiles,
  isKeyboardOpen,
  onSpendUnlock,
  liveUseDbTilesOnly = false,
  onPuzzleSlotComplete,
}: {
  conversation: PuzzleConversation
  messages: PuzzleChatMessage[]
  manualUnlockedTiles: number[]
  isKeyboardOpen: boolean
  onSpendUnlock: () => void
  /** Live：只使用 DB 回傳的格索引，避免與訊息推導的排序重疊。 */
  liveUseDbTilesOnly?: boolean
  onPuzzleSlotComplete?: (slotIndex: number) => void
}) {
  const [now, setNow] = useState(() => Date.now())
  const photoSlotCount = Math.min(
    PUZZLE_MAX_PHOTO_SLOTS,
    Math.max(1, collectConversationPhotoUrls(conversation).length),
  )
  const progress = getPuzzleProgress(
    messages,
    manualUnlockedTiles,
    conversation.matchedAt,
    now,
    String(conversation.id),
    photoSlotCount,
    liveUseDbTilesOnly,
  )
  const globalSet = new Set(progress.globalUnlockedTiles)
  const unlocked = new Set(progress.unlockedTiles)
  const globalKey = progress.globalUnlockedTiles.join(',')
  const previousUnlockedKeyRef = useRef<string | null>(null)
  const [recentlyUnlockedTiles, setRecentlyUnlockedTiles] = useState<number[]>([])
  const [unlockBurstCount, setUnlockBurstCount] = useState(0)
  const [showCompletionBurst, setShowCompletionBurst] = useState(false)
  const recentlyUnlocked = new Set(recentlyUnlockedTiles)
  const puzzleUrls = collectConversationPhotoUrls(conversation)
  const photoUrl = puzzleUrls[progress.activePhotoIndex] ?? puzzleUrls[0] ?? conversation.photoUrl
  const puzzleSvgId = `chat-puzzle-${conversation.id}`
  const puzzleTiles = Array.from({ length: 16 }, (_, tile) => tile)
  const orderedPuzzleTiles = [...puzzleTiles].sort((a, b) => Number(unlocked.has(a)) - Number(unlocked.has(b)))
  const isPuzzleComplete = puzzleSlotIsComplete(globalSet, progress.activePhotoIndex)

  useEffect(() => {
    if (!conversation.matchedAt || !progress.boostActive) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [conversation.matchedAt, progress.boostActive])

  const puzzleSlotCompleteCbRef = useRef(onPuzzleSlotComplete)
  puzzleSlotCompleteCbRef.current = onPuzzleSlotComplete

  useEffect(() => {
    const previousKey = previousUnlockedKeyRef.current
    previousUnlockedKeyRef.current = globalKey
    if (previousKey === null) return

    const prevGlobals = previousKey
      .split(',')
      .filter(Boolean)
      .map((tile) => Number(tile))
    const prevSet = new Set(prevGlobals)
    const addedGlobals = progress.globalUnlockedTiles.filter((g) => !prevSet.has(g))
    if (addedGlobals.length === 0) return

    const addedLocals = addedGlobals
      .filter((g) => Math.floor(g / 16) === progress.activePhotoIndex)
      .map((g) => g % 16)
    setRecentlyUnlockedTiles(addedLocals.length > 0 ? addedLocals : [])
    setUnlockBurstCount(addedGlobals.length)
    const nowSet = new Set(progress.globalUnlockedTiles)
    let anyComplete = false
    for (let s = 0; s < progress.photoSlotCount; s += 1) {
      if (puzzleCountPerSlot(prevSet, s) < 16 && puzzleCountPerSlot(nowSet, s) >= 16) {
        anyComplete = true
        puzzleSlotCompleteCbRef.current?.(s)
      }
    }
    if (anyComplete) {
      setShowCompletionBurst(true)
    }
    const timer = window.setTimeout(() => {
      setRecentlyUnlockedTiles([])
      setUnlockBurstCount(0)
      setShowCompletionBurst(false)
    }, 1400)
    return () => window.clearTimeout(timer)
  }, [globalKey])

  if (isKeyboardOpen) {
    return (
      <div className="relative border-t border-slate-100 bg-gradient-to-b from-white via-slate-50/80 to-white px-2.5 py-2.5">
        <AnimatePresence mode="sync">
          {unlockBurstCount > 0 && (
            <>
              <motion.div
                key={`sweep-core-${globalKey}`}
                className="pointer-events-none absolute inset-y-0 left-0 w-[38%] bg-gradient-to-r from-transparent via-white/90 to-transparent opacity-90 mix-blend-overlay shadow-[0_0_24px_rgba(255,255,255,.55)]"
                initial={{ x: '-45%', opacity: 0, scaleY: 0.92 }}
                animate={{ x: '155%', opacity: [0, 1, 1, 0.85, 0], scaleY: [0.92, 1, 1, 1, 1] }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.62, ease: [0.2, 0.9, 0.2, 1], opacity: { times: [0, 0.08, 0.45, 0.78, 1] } }}
              />
              <motion.div
                key={`sweep-halo-${globalKey}`}
                className="pointer-events-none absolute inset-y-[-2px] left-0 w-[95%] bg-gradient-to-r from-amber-200/0 via-sky-400/50 via-fuchsia-400/40 to-violet-500/0 blur-[3px]"
                initial={{ x: '-55%', opacity: 0 }}
                animate={{ x: '145%', opacity: [0, 0.95, 0.85, 0] }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.88, ease: [0.15, 0.85, 0.25, 1], delay: 0.05 }}
              />
              <motion.div
                key={`sweep-trail-${globalKey}`}
                className="pointer-events-none absolute inset-y-0 left-0 w-[55%] bg-gradient-to-r from-cyan-300/0 via-white/25 to-amber-200/0"
                initial={{ x: '-35%', opacity: 0 }}
                animate={{ x: '175%', opacity: [0, 0.7, 0] }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.72, ease: 'easeOut', delay: 0.12 }}
              />
            </>
          )}
        </AnimatePresence>
        {showCompletionBurst && (
          <motion.div
            className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <motion.div
              className="absolute h-28 w-28 rounded-full bg-[conic-gradient(from_0deg,rgba(251,191,36,.5),rgba(56,189,248,.45),rgba(167,139,250,.5),rgba(251,191,36,.5))] blur-lg"
              animate={{ rotate: 360, scale: [0.85, 1.05, 0.95] }}
              transition={{ rotate: { duration: 1.2, repeat: Infinity, ease: 'linear' }, scale: { duration: 0.8, repeat: Infinity, repeatType: 'reverse' } }}
            />
            <motion.div
              className="relative rounded-full bg-white/95 px-4 py-2 text-[12px] font-black text-amber-500 shadow-2xl shadow-amber-900/15 ring-2 ring-amber-200/80"
              initial={{ scale: 0.5, y: 16, opacity: 0 }}
              animate={{ scale: [0.5, 1.12, 1], y: 0, opacity: 1 }}
              transition={{ duration: 0.5, ease: [0.34, 1.56, 0.64, 1] }}
            >
              <span className="inline-flex items-center gap-1">
                <Sparkles className="h-4 w-4" />
                拼圖完成
              </span>
            </motion.div>
          </motion.div>
        )}
        <div className="relative flex min-h-[52px] items-center gap-2 sm:gap-2.5">
          <div className="grid shrink-0 grid-cols-4 gap-0.5 rounded-xl bg-slate-900/[0.06] p-1 ring-1 ring-slate-200/80">
            {puzzleTiles.map((tile) => {
              const on = unlocked.has(tile)
              const flash = recentlyUnlocked.has(tile)
              return (
                <motion.div
                  key={tile}
                  className={cn(
                    'h-2 w-2 rounded-[3px] sm:h-2.5 sm:w-2.5',
                    on
                      ? 'bg-gradient-to-br from-sky-400 via-indigo-500 to-violet-600 shadow-sm shadow-sky-600/30'
                      : 'bg-slate-300/90',
                  )}
                  animate={
                    flash
                      ? {
                          scale: [1, 1.75, 1],
                          boxShadow: [
                            '0 0 0 0 rgba(56,189,248,0)',
                            '0 0 14px 3px rgba(56,189,248,.7)',
                            '0 0 0 0 rgba(56,189,248,0)',
                          ],
                        }
                      : {}
                  }
                  transition={{ duration: 0.55, ease: 'easeOut' }}
                />
              )
            })}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <span className="max-w-[56%] truncate text-[11px] font-black text-slate-900 sm:max-w-[62%]">
                {conversation.name}
              </span>
              <motion.span
                key={progress.unlockedCount}
                initial={{ scale: 1.45, color: '#0284c7' }}
                animate={{ scale: 1, color: '#0f172a' }}
                transition={{ type: 'spring', stiffness: 400, damping: 18 }}
                className="tabular-nums text-[14px] font-black tracking-tight text-slate-900"
              >
                <span className="text-sky-600">{progress.unlockedCount}</span>
                <span className="text-slate-400">/16</span>
              </motion.span>
            </div>
            <p className="mt-0.5 truncate text-[10px] font-semibold leading-tight text-slate-500">
              {progress.allPhotosComplete
                ? '三張照片都已解鎖'
                : progress.photoSlotCount > 1
                  ? `第 ${progress.activePhotoIndex + 1}/${progress.photoSlotCount} 張 · 再互相 ${progress.nextRemaining || 3} 則可繼續解鎖`
                  : `再互相 ${progress.nextRemaining || 3} 則可繼續解鎖`}
            </p>
          </div>
          <AnimatePresence mode="popLayout">
            {unlockBurstCount > 0 && (
              <motion.div
                key={`kb-burst-${unlockBurstCount}-${globalKey}`}
                layout
                initial={{ opacity: 0, scale: 0.45, rotate: -10 }}
                animate={{ opacity: 1, scale: 1, rotate: 0 }}
                exit={{ opacity: 0, scale: 0.85, y: -10 }}
                transition={{ type: 'spring', stiffness: 460, damping: 26 }}
                className="flex shrink-0 items-center gap-1 rounded-full bg-gradient-to-r from-amber-400 via-sky-500 to-violet-600 px-2.5 py-1 text-[11px] font-black text-white shadow-lg shadow-indigo-900/25 ring-2 ring-white/50"
              >
                <motion.span
                  animate={{ rotate: [0, 18, -12, 0] }}
                  transition={{ duration: 0.45 }}
                >
                  <Sparkles className="h-3.5 w-3.5" />
                </motion.span>
                +{unlockBurstCount}
              </motion.div>
            )}
          </AnimatePresence>
          <button
            type="button"
            onClick={onSpendUnlock}
            disabled={progress.allPhotosComplete}
            className="relative z-[1] shrink-0 rounded-full bg-gradient-to-b from-sky-500 to-sky-600 px-3 py-1.5 text-[10px] font-black text-white shadow-md shadow-sky-600/25 ring-1 ring-sky-400/50 transition active:scale-95 disabled:bg-slate-200 disabled:text-slate-400 disabled:shadow-none disabled:ring-0"
          >
            隨機解 1 片
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="bg-white px-3 py-2 shadow-sm ring-1 ring-slate-100">
      <div className="flex h-[238px] w-full items-stretch justify-center gap-1 sm:gap-1.5">
        <div className="flex w-[76px] shrink-0 flex-col justify-center sm:w-[82px]">
          <button
            type="button"
            onClick={onSpendUnlock}
            disabled={progress.allPhotosComplete}
            className={cn(
              'w-full rounded-2xl px-2 py-3 text-[11px] font-black leading-snug shadow-sm transition active:scale-[0.98]',
              progress.allPhotosComplete
                ? 'bg-slate-100 text-slate-400'
                : 'bg-sky-500 text-white shadow-sky-500/30',
            )}
          >
            隨機解 1 片
          </button>
        </div>
        <div className="relative h-[238px] w-[150px] shrink-0 overflow-hidden rounded-3xl bg-slate-900 shadow-lg shadow-slate-900/10 ring-1 ring-slate-900/10 sm:w-[158px]">
        {photoUrl ? (
          <>
            <img
              src={photoUrl}
              alt={conversation.name}
              className="absolute inset-0 h-full w-full object-contain object-center blur-2xl opacity-45"
            />
            <div className="absolute inset-0 bg-slate-950/20" />
            {isPuzzleComplete ? (
              <motion.img
                src={photoUrl}
                alt=""
                aria-hidden
                className="absolute inset-0 h-full w-full object-contain object-center"
                initial={{ opacity: 0, scale: 1.08 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.55, ease: 'easeOut' }}
              />
            ) : (
              <svg className="absolute inset-0 h-full w-full" viewBox="0 0 400 600" preserveAspectRatio="none" aria-hidden>
                <defs>
                  <filter id={`${puzzleSvgId}-blur`}>
                    <feGaussianBlur stdDeviation="8" />
                  </filter>
                  {puzzleTiles.map((tile) => (
                    <clipPath key={tile} id={`${puzzleSvgId}-clip-${tile}`} clipPathUnits="userSpaceOnUse">
                      <path d={getPuzzleTilePath(tile)} />
                    </clipPath>
                  ))}
                </defs>
                {orderedPuzzleTiles.map((tile) => {
                  const isUnlocked = unlocked.has(tile)
                  const tilePath = getPuzzleTilePath(tile)
                  return (
                    <g key={tile}>
                      <g clipPath={`url(#${puzzleSvgId}-clip-${tile})`}>
                        <image
                          href={photoUrl}
                          x="0"
                          y="0"
                          width="400"
                          height="600"
                          preserveAspectRatio="xMidYMid meet"
                          opacity={isUnlocked ? 1 : 0.26}
                          filter={isUnlocked ? undefined : `url(#${puzzleSvgId}-blur)`}
                        />
                        {!isUnlocked && <path d={tilePath} fill="rgba(15, 23, 42, 0.38)" />}
                      </g>
                      <path d={tilePath} fill="none" stroke="rgba(255,255,255,.42)" strokeWidth="2.2" />
                      {recentlyUnlocked.has(tile) && (
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
            )}
            <div className="pointer-events-none absolute inset-0 rounded-3xl ring-1 ring-inset ring-white/20" />
            <AnimatePresence>
              {unlockBurstCount > 0 && (
                <motion.div
                  key={unlockBurstCount}
                  className="pointer-events-none absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center gap-1 rounded-full bg-white/95 px-3 py-1.5 text-[12px] font-black text-sky-600 shadow-lg shadow-sky-900/20"
                  initial={{ opacity: 0, scale: 0.72, y: 8 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.92, y: -10 }}
                  transition={{ duration: 0.28, ease: 'easeOut' }}
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  解鎖 +{unlockBurstCount}
                </motion.div>
              )}
            </AnimatePresence>
            <AnimatePresence>
              {showCompletionBurst && (
                <motion.div
                  className="pointer-events-none absolute inset-0 flex items-center justify-center"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                >
                  <motion.div
                    className="absolute inset-[-18px] rounded-[2rem] bg-[conic-gradient(from_180deg,rgba(56,189,248,.0),rgba(56,189,248,.45),rgba(251,191,36,.55),rgba(236,72,153,.45),rgba(56,189,248,.0))] blur-md"
                    initial={{ rotate: 0, scale: 0.86, opacity: 0 }}
                    animate={{ rotate: 180, scale: 1.1, opacity: [0, 1, 0] }}
                    transition={{ duration: 1.25, ease: 'easeOut' }}
                  />
                  <motion.div
                    className="relative flex items-center gap-1.5 rounded-full bg-white/95 px-4 py-2 text-[13px] font-black text-amber-500 shadow-xl shadow-amber-900/20"
                    initial={{ scale: 0.72, y: 12 }}
                    animate={{ scale: [0.72, 1.08, 1], y: 0 }}
                    transition={{ duration: 0.5, ease: 'easeOut' }}
                  >
                    <Sparkles className="h-4 w-4" />
                    拼圖完成
                  </motion.div>
                </motion.div>
              )}
            </AnimatePresence>
          </>
        ) : (
          <div
            className="absolute inset-0 flex items-center justify-center text-white"
            style={{ background: `linear-gradient(135deg, ${conversation.from}, ${conversation.to})` }}
          >
            <span className="text-4xl font-black">{conversation.initials}</span>
          </div>
        )}
        </div>
        <div className="flex min-w-0 flex-1 basis-0 max-w-[118px] flex-col justify-center gap-2.5 pl-0.5 sm:max-w-[124px]">
          <div className="space-y-1">
            <p className="truncate text-[11px] font-black leading-tight text-slate-900">
              {conversation.name} 的拼圖
              {progress.photoSlotCount > 1 && !progress.allPhotosComplete && (
                <span className="ml-1 font-bold text-sky-600">
                  第 {progress.activePhotoIndex + 1} 張，共 {progress.photoSlotCount} 張
                </span>
              )}
            </p>
            <p className="flex items-baseline gap-0.5 tabular-nums">
              <span className="text-[22px] font-black leading-none tracking-tight text-slate-900">
                {progress.unlockedCount}
              </span>
              <span className="text-[13px] font-bold text-slate-400">/16</span>
            </p>
          </div>
          <p className="border-l-2 border-sky-200/90 pl-2 text-[10px] font-medium leading-relaxed text-slate-500">
            {progress.allPhotosComplete
              ? '三張照片都已解鎖'
              : `再互相 ${progress.nextRemaining || 3} 則解下一格`}
          </p>
          {progress.boostActive && (
            <div className="rounded-xl bg-gradient-to-br from-amber-50 to-orange-50/90 px-2.5 py-2 shadow-sm ring-1 ring-amber-100/80">
              <p className="text-[9px] font-semibold leading-tight text-amber-800/90">
                配對完成後 30 分鐘內
              </p>
              <p className="mt-1 text-[10px] font-black leading-tight text-amber-700">
                拼圖解鎖加倍剩餘 {formatPuzzleBoostCountdown(progress.boostRemainingMs)}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
