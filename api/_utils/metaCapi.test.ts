import { describe, expect, it } from 'vitest'
import {
  META_CAPI_REQUEST_TIMEOUT_MS,
  buildMetaCapiUserData,
  hashMetaExternalId,
  normalizeMetaEmail,
  sanitizeMetaFbc,
  sanitizeMetaFbp,
  sha256MetaNormalized,
} from './metaCapi'

describe('metaCapi helpers', () => {
  it('normalizes email before hash', () => {
    expect(normalizeMetaEmail('  User@Example.COM ')).toBe('user@example.com')
  })

  it('hashes normalized email', () => {
    const h = sha256MetaNormalized('test@example.com')
    expect(h).toMatch(/^[a-f0-9]{64}$/)
  })

  it('hashes external_id', () => {
    const h = hashMetaExternalId('550e8400-e29b-41d4-a716-446655440000')
    expect(h).toMatch(/^[a-f0-9]{64}$/)
  })

  it('uses bounded request timeout', () => {
    expect(META_CAPI_REQUEST_TIMEOUT_MS).toBe(6000)
  })

  it('accepts valid fbp/fbc prefixes', () => {
    expect(sanitizeMetaFbp('fb.1.123.456')).toBe('fb.1.123.456')
    expect(sanitizeMetaFbc('fb.1.123.clid')).toBe('fb.1.123.clid')
    expect(sanitizeMetaFbp('bad')).toBeNull()
  })

  it('builds user_data with hashed em and external_id', () => {
    const ud = buildMetaCapiUserData({
      externalId: '550e8400-e29b-41d4-a716-446655440000',
      email: 'User@Example.com',
      fbp: 'fb.1.1.1',
    })
    expect(ud.external_id).toEqual([hashMetaExternalId('550e8400-e29b-41d4-a716-446655440000')])
    expect(ud.em).toEqual([sha256MetaNormalized('user@example.com')])
    expect(ud.fbp).toBe('fb.1.1.1')
  })
})
