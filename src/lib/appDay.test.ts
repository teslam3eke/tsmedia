import { describe, expect, it } from 'vitest'
import { msUntilNextTaipei2200, taipeiWallCalendarKey } from '@/lib/appDay'

/** 台北牆上時間 → UTC Date（台灣恒 UTC+8）。 */
function taipeiWallAsUtcDate(y: number, m: number, d: number, hour: number, minute = 0, second = 0): Date {
  return new Date(Date.UTC(y, m - 1, d, hour - 8, minute, second))
}

describe('msUntilNextTaipei2200', () => {
  it('21:59:59 台北距 22:00:00 為 1 秒', () => {
    const now = taipeiWallAsUtcDate(2026, 5, 30, 21, 59, 59)
    expect(msUntilNextTaipei2200(now)).toBe(1000)
  })

  it('22:00:01 台北排程到隔日 22:00', () => {
    const now = taipeiWallAsUtcDate(2026, 5, 30, 22, 0, 1)
    const delay = msUntilNextTaipei2200(now)
    const target = new Date(now.getTime() + delay)
    expect(taipeiWallCalendarKey(target)).toBe('2026-05-31')
    expect(target.getUTCHours()).toBe(14)
    expect(target.getUTCMinutes()).toBe(0)
    expect(target.getUTCSeconds()).toBe(0)
  })
})
