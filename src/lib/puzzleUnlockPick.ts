import { PUZZLE_MAX_PHOTO_SLOTS } from '@/lib/types'

export function puzzleTileManhattan(a: number, b: number): number {
  const ra = Math.floor(a / 4)
  const ca = a % 4
  const rb = Math.floor(b / 4)
  const cb = b % 4
  return Math.abs(ra - rb) + Math.abs(ca - cb)
}

export function puzzleTilesAdjacent(a: number, b: number): boolean {
  return puzzleTileManhattan(a, b) === 1
}

export function puzzleMinDistToOccupied(tile: number, occupied: ReadonlySet<number>): number {
  if (occupied.size === 0) return Infinity
  let d = Infinity
  for (const t of occupied) {
    d = Math.min(d, puzzleTileManhattan(tile, t))
  }
  return d
}

/** 單張 4×4：優先避開與 avoidAdjacentTo 相鄰；再最大化與已解鎖格的最小距離。 */
export function pickOnePuzzleTileLocal(
  occupied: ReadonlySet<number>,
  avoidAdjacentTo: number | null,
  rng: () => number,
): number | null {
  const candidates: number[] = []
  for (let t = 0; t < 16; t += 1) {
    if (!occupied.has(t)) candidates.push(t)
  }
  if (candidates.length === 0) return null

  let pool = candidates
  if (avoidAdjacentTo !== null) {
    const nonAdjacent = candidates.filter((t) => !puzzleTilesAdjacent(t, avoidAdjacentTo))
    if (nonAdjacent.length > 0) pool = nonAdjacent
  }

  let best = -1
  const ties: number[] = []
  for (const t of pool) {
    const md = puzzleMinDistToOccupied(t, occupied)
    if (md > best) {
      best = md
      ties.length = 0
      ties.push(t)
    } else if (md === best) {
      ties.push(t)
    }
  }
  return ties[Math.floor(rng() * ties.length)] ?? null
}

export function pickOnePuzzleTileGlobalInSlot(
  occupiedGlobal: ReadonlySet<number>,
  slot: number,
  avoidAdjacentToLocal: number | null,
  rng: () => number,
): number | null {
  const base = slot * 16
  const occupiedLocal = new Set<number>()
  for (const g of occupiedGlobal) {
    if (g >= base && g < base + 16) occupiedLocal.add(g - base)
  }
  const pick = pickOnePuzzleTileLocal(occupiedLocal, avoidAdjacentToLocal, rng)
  if (pick === null) return null
  return base + pick
}

export function puzzleHashSeed(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

export function puzzleMulberry32(seed: number): () => number {
  return () => {
    let t = (seed += 0x6d2b79f5)
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function puzzleSlotIsComplete(globalSet: ReadonlySet<number>, slot: number): boolean {
  const base = slot * 16
  for (let l = 0; l < 16; l += 1) {
    if (!globalSet.has(base + l)) return false
  }
  return true
}

export function puzzleCountPerSlot(globalSet: ReadonlySet<number>, slot: number): number {
  const base = slot * 16
  let n = 0
  for (let l = 0; l < 16; l += 1) {
    if (globalSet.has(base + l)) n += 1
  }
  return n
}

/** 依聊天輪次順序回放解鎖格（含 boost 第二格）；與 DB 無關，由訊息推導。 */
export function computeChatUnlockedGlobalTiles(params: {
  round: number
  mult: number
  slots: number
  manualUnlockedTiles: number[]
  puzzleSeedKey: string
  matchedAt?: number
}): number[] {
  const { round, mult, slots, manualUnlockedTiles, puzzleSeedKey, matchedAt } = params
  const rng = puzzleMulberry32(puzzleHashSeed(`${puzzleSeedKey}|puzzle|${matchedAt ?? 0}`))
  const occupied = new Set<number>(manualUnlockedTiles)
  const chatTiles: number[] = []

  const addChatUnlock = (slot: number, avoidAdjacentToLocal: number | null): number | null => {
    const global = pickOnePuzzleTileGlobalInSlot(occupied, slot, avoidAdjacentToLocal, rng)
    if (global === null) return null
    chatTiles.push(global)
    occupied.add(global)
    return global % 16
  }

  for (let r = 1; r <= round; r += 1) {
    const slot = Math.floor((r - 1) / 16)
    if (slot >= slots) break

    const prevGlobal = chatTiles.length > 0 ? chatTiles[chatTiles.length - 1]! : null
    const avoidPrev =
      prevGlobal !== null && Math.floor(prevGlobal / 16) === slot ? prevGlobal % 16 : null

    const firstLocal = addChatUnlock(slot, avoidPrev)
    if (mult === 2 && firstLocal !== null) {
      addChatUnlock(slot, firstLocal)
    }
  }

  return chatTiles
}

/** 連續解鎖序列中，指定 slot 最後一格的 local index（聊天先、道具後）。 */
export function getLastUnlockedLocalInSlot(
  chatTilesOrdered: number[],
  manualTilesOrdered: number[],
  slot: number,
): number | null {
  let last: number | null = null
  for (const g of chatTilesOrdered) {
    if (Math.floor(g / 16) === slot) last = g % 16
  }
  for (const g of manualTilesOrdered) {
    if (Math.floor(g / 16) === slot) last = g % 16
  }
  return last
}

/** 道具「隨機解 1 片」：與聊天解鎖同一套 spread + 避開上一格相鄰。 */
export function pickNextBlurUnlockGlobalTile(params: {
  chatTilesOrdered: number[]
  manualUnlockedTiles: number[]
  activePhotoIndex: number
  puzzleSeedKey: string
  matchedAt?: number
  spendIndex?: number
  extraOccupiedGlobal?: ReadonlySet<number>
}): number | null {
  const {
    chatTilesOrdered,
    manualUnlockedTiles,
    activePhotoIndex,
    puzzleSeedKey,
    matchedAt,
    spendIndex = manualUnlockedTiles.length,
    extraOccupiedGlobal,
  } = params
  const slot = activePhotoIndex
  const occupiedGlobal = new Set<number>([...chatTilesOrdered, ...manualUnlockedTiles])
  if (extraOccupiedGlobal) {
    for (const g of extraOccupiedGlobal) occupiedGlobal.add(g)
  }
  const avoidLocal = getLastUnlockedLocalInSlot(chatTilesOrdered, manualUnlockedTiles, slot)
  const rng = puzzleMulberry32(
    puzzleHashSeed(`${puzzleSeedKey}|blur|${matchedAt ?? 0}|${spendIndex}|${extraOccupiedGlobal?.size ?? 0}`),
  )
  return pickOnePuzzleTileGlobalInSlot(occupiedGlobal, slot, avoidLocal, rng)
}

/** 探索示意：依序解鎖 need 格（同一 slot）。 */
export function pickPuzzleTilesLocalBatch(
  prev: ReadonlySet<number>,
  need: number,
  puzzleSeedKey: string,
  batchIndex: number,
): number[] {
  const rng = puzzleMulberry32(puzzleHashSeed(`${puzzleSeedKey}|intro|${batchIndex}`))
  const occupied = new Set(prev)
  const out: number[] = []
  for (let i = 0; i < need; i += 1) {
    const avoid = out.length > 0 ? out[out.length - 1]! : null
    const pick = pickOnePuzzleTileLocal(occupied, avoid, rng)
    if (pick === null) break
    out.push(pick)
    occupied.add(pick)
  }
  return out
}

export function clampPuzzlePhotoSlots(photoSlotCount: number): number {
  return Math.max(1, Math.min(PUZZLE_MAX_PHOTO_SLOTS, photoSlotCount))
}
