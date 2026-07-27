import { describe, expect, it } from 'vitest'
import { isOnJoinRoute, pathnameIsJoin } from './marketingRoutes'

describe('pathnameIsJoin', () => {
  it('accepts /join with optional trailing slash', () => {
    expect(pathnameIsJoin('/join')).toBe(true)
    expect(pathnameIsJoin('/join/')).toBe(true)
  })

  it('rejects homepage and unrelated paths', () => {
    expect(pathnameIsJoin('/')).toBe(false)
    expect(pathnameIsJoin('/reset-password')).toBe(false)
    expect(pathnameIsJoin('/join-us')).toBe(false)
  })
})

describe('isOnJoinRoute', () => {
  it('returns false without window', () => {
    expect(isOnJoinRoute()).toBe(false)
  })
})
