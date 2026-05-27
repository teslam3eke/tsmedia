import { describe, expect, it } from 'vitest'
import { isInstantMatchOpenNow, msUntilInstantMatchOpens } from '@/lib/instantMatchHours'

/** 以 UTC 偏移建構「台北牆上時間」對應的 Date（僅供測試）。 */
function taipeiWallAsUtcDate(hour: number, minute = 0): Date {
  const d = new Date()
  const y = d.getUTCFullYear()
  const m = d.getUTCMonth()
  const day = d.getUTCDate()
  return new Date(Date.UTC(y, m, day, hour - 8, minute, 0))
}

describe('isInstantMatchOpenNow', () => {
  it('22:00–23:59 台北為開放', () => {
    expect(isInstantMatchOpenNow(taipeiWallAsUtcDate(22, 0))).toBe(true)
    expect(isInstantMatchOpenNow(taipeiWallAsUtcDate(23, 30))).toBe(true)
  })

  it('00:00–00:59 台北為開放', () => {
    expect(isInstantMatchOpenNow(taipeiWallAsUtcDate(0, 15))).toBe(true)
  })

  it('01:00 起至 21:59 台北為關閉', () => {
    expect(isInstantMatchOpenNow(taipeiWallAsUtcDate(1, 0))).toBe(false)
    expect(isInstantMatchOpenNow(taipeiWallAsUtcDate(12, 0))).toBe(false)
    expect(isInstantMatchOpenNow(taipeiWallAsUtcDate(21, 59))).toBe(false)
  })
})

describe('msUntilInstantMatchOpens', () => {
  it('開放中回傳 0', () => {
    expect(msUntilInstantMatchOpens(taipeiWallAsUtcDate(22, 10))).toBe(0)
  })

  it('關閉中為正數', () => {
    expect(msUntilInstantMatchOpens(taipeiWallAsUtcDate(10, 0))).toBeGreaterThan(0)
  })
})
