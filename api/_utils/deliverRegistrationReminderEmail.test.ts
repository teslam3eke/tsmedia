import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { registrationReminderStageMinAgeMs } from './registrationReminderEligibility'
import { deliverRegistrationReminderEmailIfNeeded } from './deliverRegistrationReminderEmailIfNeeded'

const eligibleAfterMs = Date.now() - 30 * 86400_000
const confirmedAt = new Date(
  Date.now() - registrationReminderStageMinAgeMs(1) - 3600_000,
).toISOString()

function mockAdmin(overrides: {
  claim?: unknown
  hasApplication?: boolean
  hasLegacyDocs?: boolean
  email?: string | null
  emailConfirmedAt?: string | null
}): SupabaseClient {
  const rpc = vi.fn(async (name: string) => {
    if (name === 'claim_registration_reminder_email_delivery') {
      return { data: overrides.claim ?? null, error: null }
    }
    if (name === 'mark_registration_reminder_email_sent') {
      return { data: { ok: true }, error: null }
    }
    if (name === 'release_registration_reminder_email_in_flight') {
      return { data: { ok: true }, error: null }
    }
    return { data: null, error: null }
  })

  const from = vi.fn((table: string) => {
    if (table === 'verification_applications') {
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        limit: vi.fn(async () => ({
          data: overrides.hasApplication ? [{ id: 'a1' }] : [],
          error: null,
        })),
      }
    }
    if (table === 'verification_docs') {
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        limit: vi.fn(async () => ({
          data: overrides.hasLegacyDocs ? [{ id: 'd1' }] : [],
          error: null,
        })),
      }
    }
    if (table === 'registration_reminder_email_deliveries') {
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        not: vi.fn().mockReturnThis(),
        limit: vi.fn(async () => ({ data: [], error: null })),
      }
    }
    return {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      limit: vi.fn(async () => ({ data: [], error: null })),
    }
  })

  const email = overrides.email ?? 'u@example.com'
  const emailConfirmedAt = overrides.emailConfirmedAt ?? confirmedAt

  return {
    rpc,
    from,
    auth: {
      admin: {
        getUserById: vi.fn(async () => ({
          data: {
            user: email
              ? { email, email_confirmed_at: emailConfirmedAt }
              : null,
          },
          error: null,
        })),
      },
    },
  } as unknown as SupabaseClient
}

describe('deliverRegistrationReminderEmailIfNeeded', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ id: 'resend-1' }), { status: 200 })),
    )
    process.env.RESEND_API_KEY = 're_test'
    process.env.APPROVAL_EMAIL_FROM = 'tsmedia <noreply@tsmedia.tw>'
  })

  it('12–13. marks sent; claim then application exists skips send', async () => {
    const admin = mockAdmin({
      claim: { ok: true, user_id: 'u1', reminder_stage: 1 },
      hasApplication: true,
      email: 'u@example.com',
    })
    const r = await deliverRegistrationReminderEmailIfNeeded(admin, 'u1', {
      stage: 1,
      emailConfirmedAt: confirmedAt,
      eligibleAfterMs,
      hasAnyVerificationApplication: false,
      hasLegacyVerificationDocsOnly: false,
    })
    expect(r).toBe('skipped')
    expect(admin.rpc).toHaveBeenCalledWith('release_registration_reminder_email_in_flight', {
      p_user_id: 'u1',
      p_reminder_stage: 1,
      p_error: 'verification_application_exists',
    })
    expect(admin.rpc).not.toHaveBeenCalledWith('mark_registration_reminder_email_sent', expect.anything())
  })

  it('14–15. resend success marks sent; already sent skips claim path', async () => {
    const admin = mockAdmin({
      claim: { ok: true, user_id: 'u2', reminder_stage: 1 },
      hasApplication: false,
      email: 'u2@example.com',
    })
    const r = await deliverRegistrationReminderEmailIfNeeded(admin, 'u2', {
      stage: 1,
      emailConfirmedAt: confirmedAt,
      eligibleAfterMs,
      hasAnyVerificationApplication: false,
      hasLegacyVerificationDocsOnly: false,
    })
    expect(r).toBe('sent')
    expect(admin.rpc).toHaveBeenCalledWith('mark_registration_reminder_email_sent', {
      p_user_id: 'u2',
      p_reminder_stage: 1,
    })
  })

  it('16. already_sent from claim', async () => {
    const admin = mockAdmin({
      claim: { ok: false, reason: 'already_sent' },
      email: 'u@example.com',
    })
    const r = await deliverRegistrationReminderEmailIfNeeded(admin, 'u1', {
      stage: 1,
      emailConfirmedAt: confirmedAt,
      eligibleAfterMs,
      hasAnyVerificationApplication: false,
      hasLegacyVerificationDocsOnly: false,
    })
    expect(r).toBe('already_sent')
  })

  it('14. resend failure releases in flight (stage 1)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ message: 'fail' }), { status: 500 })),
    )
    const admin = mockAdmin({
      claim: { ok: true, user_id: 'u3', reminder_stage: 1 },
      email: 'u3@example.com',
    })
    const r = await deliverRegistrationReminderEmailIfNeeded(admin, 'u3', {
      stage: 1,
      emailConfirmedAt: confirmedAt,
      eligibleAfterMs,
      hasAnyVerificationApplication: false,
      hasLegacyVerificationDocsOnly: false,
    })
    expect(r).toBe('failed')
    expect(admin.rpc).toHaveBeenCalledWith('release_registration_reminder_email_in_flight', {
      p_user_id: 'u3',
      p_reminder_stage: 1,
      p_error: expect.any(String),
    })
  })
})
