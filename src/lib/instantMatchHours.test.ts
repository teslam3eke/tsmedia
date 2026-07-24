import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  instantMatchAlwaysOpenForTesting,
  isInstantMatchOpenNow,
  msUntilInstantMatchOpens,
} from '@/lib/instantMatchHours'

/** 以 UTC 偏移建構「台北牆上時間」對應的 Date（僅供測試）。 */
function taipeiWallAsUtcDate(hour: number, minute = 0): Date {
  const d = new Date()
  const y = d.getUTCFullYear()
  const m = d.getUTCMonth()
  const day = d.getUTCDate()
  return new Date(Date.UTC(y, m, day, hour - 8, minute, 0))
}

describe('isInstantMatchOpenNow', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_INSTANT_MATCH_ALWAYS_OPEN', '')
  })
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('測試期間所有時段皆開放', () => {
    expect(isInstantMatchOpenNow(taipeiWallAsUtcDate(1, 0))).toBe(true)
    expect(isInstantMatchOpenNow(taipeiWallAsUtcDate(12, 0))).toBe(true)
    expect(isInstantMatchOpenNow(taipeiWallAsUtcDate(21, 59))).toBe(true)
    expect(isInstantMatchOpenNow(taipeiWallAsUtcDate(22, 0))).toBe(true)
    expect(isInstantMatchOpenNow(taipeiWallAsUtcDate(23, 30))).toBe(true)
    expect(isInstantMatchOpenNow(taipeiWallAsUtcDate(0, 15))).toBe(true)
  })
})

describe('instantMatchAlwaysOpenForTesting', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('VITE_INSTANT_MATCH_ALWAYS_OPEN=1 時任何時間為開放', () => {
    vi.stubEnv('VITE_INSTANT_MATCH_ALWAYS_OPEN', '1')
    expect(instantMatchAlwaysOpenForTesting()).toBe(true)
    expect(isInstantMatchOpenNow(taipeiWallAsUtcDate(12, 0))).toBe(true)
  })
})

describe('msUntilInstantMatchOpens', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_INSTANT_MATCH_ALWAYS_OPEN', '')
  })
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('開放中回傳 0', () => {
    expect(msUntilInstantMatchOpens(taipeiWallAsUtcDate(22, 10))).toBe(0)
  })

  it('測試期間任意時段皆回傳 0', () => {
    expect(msUntilInstantMatchOpens(taipeiWallAsUtcDate(10, 0))).toBe(0)
  })
})
