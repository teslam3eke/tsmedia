import { describe, expect, it } from 'vitest'
import {
  computeChatUnlockedGlobalTiles,
  getRecentMatchBoostState,
  pickBlurUnlockGlobalTiles,
  pickOnePuzzleTileLocal,
  pickPuzzleTilesLocalBatch,
  puzzleMulberry32,
  puzzleTilesAdjacent,
  RECENT_MATCH_BOOST_MS,
} from '@/lib/puzzleUnlockPick'

describe('pickOnePuzzleTileLocal', () => {
  it('連續兩格不相鄰（有非相鄰候選時）', () => {
    const rng = puzzleMulberry32(42)
    const occupied = new Set([5])
    const second = pickOnePuzzleTileLocal(occupied, 5, rng)
    expect(second).not.toBeNull()
    expect(puzzleTilesAdjacent(5, second!)).toBe(false)
  })

  it('首格空盤時可解鎖任意格', () => {
    const rng = puzzleMulberry32(99)
    const first = pickOnePuzzleTileLocal(new Set(), null, rng)
    expect(first).not.toBeNull()
    expect(first).toBeGreaterThanOrEqual(0)
    expect(first).toBeLessThan(16)
  })
})

describe('computeChatUnlockedGlobalTiles', () => {
  it('前幾輪解鎖不會都擠在 4×4 正中四格', () => {
    const chatTiles = computeChatUnlockedGlobalTiles({
      round: 4,
      mult: 1,
      slots: 1,
      manualUnlockedTiles: [],
      puzzleSeedKey: 'test-match',
      matchedAt: 1_700_000_000_000,
    })
    expect(chatTiles).toHaveLength(4)
    const locals = chatTiles.map((g) => g % 16)
    const centerCluster = new Set([5, 6, 9, 10])
    expect(locals.every((t) => centerCluster.has(t))).toBe(false)
  })

  it('同一輪 boost 第二格不與第一格相鄰', () => {
    const chatTiles = computeChatUnlockedGlobalTiles({
      round: 1,
      mult: 2,
      slots: 1,
      manualUnlockedTiles: [],
      puzzleSeedKey: 'boost-test',
      matchedAt: 1_700_000_000_000,
    })
    expect(chatTiles).toHaveLength(2)
    const a = chatTiles[0]! % 16
    const b = chatTiles[1]! % 16
    expect(puzzleTilesAdjacent(a, b)).toBe(false)
  })

  it('相鄰候選用盡時仍可解鎖（不卡住）', () => {
    const occupied = new Set([0, 1, 4, 5])
    const rng = puzzleMulberry32(7)
    const next = pickOnePuzzleTileLocal(occupied, 5, rng)
    expect(next).not.toBeNull()
    expect(occupied.has(next!)).toBe(false)
  })
})

describe('getRecentMatchBoostState', () => {
  it('配對後 30 分鐘內 mult 為 2', () => {
    const matchedAt = 1_700_000_000_000
    const state = getRecentMatchBoostState(matchedAt, true, matchedAt + 5 * 60 * 1000)
    expect(state.boostActive).toBe(true)
    expect(state.mult).toBe(2)
    expect(state.boostRemainingMs).toBe(RECENT_MATCH_BOOST_MS - 5 * 60 * 1000)
  })

  it('超過 30 分鐘或即時升格關閉時 mult 為 1', () => {
    const matchedAt = 1_700_000_000_000
    expect(getRecentMatchBoostState(matchedAt, true, matchedAt + RECENT_MATCH_BOOST_MS + 1).mult).toBe(1)
    expect(getRecentMatchBoostState(matchedAt, false, matchedAt).mult).toBe(1)
  })
})

describe('pickBlurUnlockGlobalTiles', () => {
  it('boost 期間一次解 2 片且第二片不與第一片相鄰', () => {
    const tiles = pickBlurUnlockGlobalTiles({
      chatTilesOrdered: [],
      manualUnlockedTiles: [],
      activePhotoIndex: 0,
      puzzleSeedKey: 'boost-blur',
      matchedAt: 1_700_000_000_000,
      boostActive: true,
    })
    expect(tiles).toHaveLength(2)
    expect(puzzleTilesAdjacent(tiles[0]! % 16, tiles[1]! % 16)).toBe(false)
  })

  it('非 boost 期間只解 1 片', () => {
    const tiles = pickBlurUnlockGlobalTiles({
      chatTilesOrdered: [],
      manualUnlockedTiles: [],
      activePhotoIndex: 0,
      puzzleSeedKey: 'normal-blur',
      matchedAt: 1_700_000_000_000,
      boostActive: false,
    })
    expect(tiles).toHaveLength(1)
  })
})

describe('pickPuzzleTilesLocalBatch', () => {
  it('批次解鎖每步盡量不與上一格相鄰', () => {
    const batch = pickPuzzleTilesLocalBatch(new Set(), 5, 'intro', 0)
    expect(batch.length).toBe(5)
    for (let i = 1; i < batch.length; i += 1) {
      expect(puzzleTilesAdjacent(batch[i - 1]!, batch[i]!)).toBe(false)
    }
  })
})
