import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const migration169 = fs.readFileSync(
  path.join(root, 'supabase/migrations/169_verification_auto_review_state.sql'),
  'utf8',
)

/** 與 migration 169 trigger 語意對齊，供 CI 行為矩陣（非 DB 整合） */
function strikeWriteAllowed(params: {
  jwtRole: string
  op: 'insert' | 'update'
  oldStrike: number
  newStrike: number
}): boolean {
  if (params.jwtRole === 'service_role') return true
  if (params.op === 'insert') return params.newStrike === 0
  return params.newStrike === params.oldStrike
}

describe('migration 169 verification_text_auto_strikes guard', () => {
  it('defines trigger function and profiles trigger with service_role bypass', () => {
    expect(migration169).toMatch(/_profiles_guard_verification_text_auto_strikes/i)
    expect(migration169).toMatch(/profiles_guard_verification_text_auto_strikes/i)
    expect(migration169).toMatch(/auth\.jwt\(\)\s*->>\s*'role'/i)
    expect(migration169).toMatch(/service_role/i)
    expect(migration169).toMatch(/42501/i)
    expect(migration169).toMatch(
      /before insert or update of verification_text_auto_strikes on public\.profiles/i,
    )
  })

  it('1. authenticated user may update profile without changing strikes (UPDATE OF column)', () => {
    expect(strikeWriteAllowed({ jwtRole: 'authenticated', op: 'update', oldStrike: 1, newStrike: 1 })).toBe(
      true,
    )
  })

  it('2. authenticated user cannot reset strikes to 0 when changing column', () => {
    expect(strikeWriteAllowed({ jwtRole: 'authenticated', op: 'update', oldStrike: 2, newStrike: 0 })).toBe(
      false,
    )
  })

  it('3. authenticated user cannot increase or modify strikes', () => {
    expect(strikeWriteAllowed({ jwtRole: 'authenticated', op: 'update', oldStrike: 0, newStrike: 1 })).toBe(
      false,
    )
    expect(strikeWriteAllowed({ jwtRole: 'authenticated', op: 'insert', oldStrike: 0, newStrike: 3 })).toBe(
      false,
    )
  })

  it('4–5. service_role may increment or reset strikes', () => {
    expect(strikeWriteAllowed({ jwtRole: 'service_role', op: 'update', oldStrike: 0, newStrike: 1 })).toBe(
      true,
    )
    expect(strikeWriteAllowed({ jwtRole: 'service_role', op: 'update', oldStrike: 2, newStrike: 0 })).toBe(
      true,
    )
  })

  it('6–7. auto review + admin paths use service_role for strike writes (documented in api)', () => {
    const autoReview = fs.readFileSync(path.join(root, 'api/_utils/verificationAutoReview.ts'), 'utf8')
    const approveReview = fs.readFileSync(
      path.join(root, 'api/_utils/verificationApplicationReview.ts'),
      'utf8',
    )
    expect(autoReview).toMatch(/verification_text_auto_strikes/)
    expect(approveReview).toMatch(/verification_text_auto_strikes:\s*0/)
    const submitApi = fs.readFileSync(path.join(root, 'api/submit-verification-application.ts'), 'utf8')
    expect(submitApi).toMatch(/SUPABASE_SERVICE_ROLE_KEY/)
  })
})
