import { describe, expect, it } from 'vitest'
import {
  REGISTRATION_CAPI_MAX_AGE_MS,
  isRegistrationCapiWindowOpen,
} from './metaCapiRegistrationWindow'

describe('registration CAPI window', () => {
  it('allows delivery within 7 days of registration', () => {
    const now = Date.parse('2026-10-14T12:00:00Z')
    const created = new Date(now - REGISTRATION_CAPI_MAX_AGE_MS + 60_000).toISOString()
    expect(isRegistrationCapiWindowOpen(created, now)).toBe(true)
  })

  it('blocks old account login backfill beyond 7 days', () => {
    const now = Date.parse('2026-10-14T12:00:00Z')
    const created = new Date(now - REGISTRATION_CAPI_MAX_AGE_MS - 1).toISOString()
    expect(isRegistrationCapiWindowOpen(created, now)).toBe(false)
  })
})
