import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { registrationReminderStageMinAgeMs } from './registrationReminderEligibility'
import {
  assertAuthoritativeRegistrationReminderSendReady,
  deliverRegistrationReminderEmailIfNeeded,
  retryPendingRegistrationReminderEmails,
  type RegistrationReminderRunGuard,
} from './deliverRegistrationReminderEmailIfNeeded'
const eligibleAfterMs = Date.now() - 30 * 86400_000

function confirmedAtHoursAgo(hours: number): string {
  return new Date(Date.now() - hours * 3600_000).toISOString()
}

function buildDeliverMocks(options: {
  sentStages?: number[]
  claimOk?: boolean
  applications?: boolean
  legacyDocs?: boolean
}) {
  const sentStages = new Set(options.sentStages ?? [])
  const rpc = vi.fn(async (name: string, args?: Record<string, unknown>) => {
    if (name === 'claim_registration_reminder_email_delivery') {
      return {
        data: options.claimOk === false ? { ok: false, reason: 'already_sent' } : {
          ok: true,
          user_id: args?.p_user_id,
          reminder_stage: args?.p_reminder_stage,
        },
        error: null,
      }
    }
    if (name === 'mark_registration_reminder_email_sent') return { data: { ok: true }, error: null }
    if (name === 'release_registration_reminder_email_in_flight') return { data: { ok: true }, error: null }
    if (name === 'registration_reminder_eligible_after') {
      return { data: new Date(eligibleAfterMs).toISOString(), error: null }
    }
    return { data: null, error: null }
  })

  const from = vi.fn((table: string) => {
    if (table === 'registration_reminder_email_deliveries') {
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        not: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        limit: vi.fn(async () => ({
          data: [...sentStages].map((s) => ({ reminder_stage: s })),
          error: null,
        })),
        gte: vi.fn().mockReturnThis(),
      }
    }
    if (table === 'verification_applications') {
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        limit: vi.fn(async () => ({
          data: options.applications ? [{ id: 'a1' }] : [],
          error: null,
        })),
      }
    }
    if (table === 'verification_docs') {
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        limit: vi.fn(async () => ({
          data: options.legacyDocs ? [{ id: 'd1' }] : [],
          error: null,
        })),
      }
    }
    return {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      limit: vi.fn(async () => ({ data: [], error: null })),
      range: vi.fn(async () => ({ data: [], error: null })),
    }
  })

  const emailConfirmedAt = confirmedAtHoursAgo(80)
  const admin = {
    rpc,
    from,
    auth: {
      admin: {
        getUserById: vi.fn(async () => ({
          data: {
            user: { email: 'u@example.com', email_confirmed_at: emailConfirmedAt },
          },
          error: null,
        })),
        listUsers: vi.fn(async () => ({ data: { users: [] }, error: null })),
      },
    },
  } as unknown as SupabaseClient

  return { admin, rpc, emailConfirmedAt }
}

describe('registration reminder guard (predecessor + run)', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ id: 'resend-1' }), { status: 200 })),
    )
    process.env.RESEND_API_KEY = 're_test'
    process.env.APPROVAL_EMAIL_FROM = 'tsmedia <noreply@tsmedia.tw>'
  })

  it('E. retry stage2 path blocked when stage1 not sent (predecessor)', async () => {
    const { admin, emailConfirmedAt } = buildDeliverMocks({ sentStages: [] })
    const ready = await assertAuthoritativeRegistrationReminderSendReady(admin, {
      userId: 'u1',
      stage: 2,
      emailConfirmedAt,
      eligibleAfterMs,
      hasAnyVerificationApplication: false,
      hasLegacyVerificationDocsOnly: false,
      lifecycleGender: 'unknown',
    })
    expect(ready.ok).toBe(false)
    if (!ready.ok) expect(ready.reason).toBe('predecessor_stage_not_sent')
  })

  it('F. stage3 blocked when stage2 not sent', async () => {
    const { admin, emailConfirmedAt } = buildDeliverMocks({ sentStages: [1] })
    const ready = await assertAuthoritativeRegistrationReminderSendReady(admin, {
      userId: 'u1',
      stage: 3,
      emailConfirmedAt,
      eligibleAfterMs,
      hasAnyVerificationApplication: false,
      hasLegacyVerificationDocsOnly: false,
      lifecycleGender: 'female',
    })
    expect(ready.ok).toBe(false)
    if (!ready.ok) expect(ready.reason).toBe('predecessor_stage_not_sent')
  })

  it('G/H. claim stage2/3 then predecessor invalid → release, no mark', async () => {
    const { admin, rpc, emailConfirmedAt } = buildDeliverMocks({ sentStages: [] })
    const r = await deliverRegistrationReminderEmailIfNeeded(admin, 'u1', {
      stage: 2,
      emailConfirmedAt,
      eligibleAfterMs,
      hasAnyVerificationApplication: false,
      hasLegacyVerificationDocsOnly: false,
      lifecycleGender: 'unknown',
    })
    expect(r).toBe('skipped')
    expect(rpc).toHaveBeenCalledWith('release_registration_reminder_email_in_flight', {
      p_user_id: 'u1',
      p_reminder_stage: 2,
      p_error: 'predecessor_stage_not_sent',
    })
    expect(rpc).not.toHaveBeenCalledWith('mark_registration_reminder_email_sent', expect.anything())
  })

  it('I. claim 後 submit application → release', async () => {
    const { admin, rpc, emailConfirmedAt } = buildDeliverMocks({ sentStages: [] })
    const from = admin.from as ReturnType<typeof vi.fn>
    from.mockImplementation((table: string) => {
      if (table === 'registration_reminder_email_deliveries') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          not: vi.fn().mockReturnThis(),
          limit: vi.fn(async () => ({ data: [], error: null })),
        }
      }
      if (table === 'verification_applications') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          limit: vi.fn(async () => ({ data: [{ id: 'a1' }], error: null })),
        }
      }
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        limit: vi.fn(async () => ({ data: [], error: null })),
      }
    })

    const r = await deliverRegistrationReminderEmailIfNeeded(admin, 'u1', {
      stage: 1,
      emailConfirmedAt,
      eligibleAfterMs,
      hasAnyVerificationApplication: false,
      hasLegacyVerificationDocsOnly: false,
      lifecycleGender: 'unknown',
    })
    expect(r).toBe('skipped')
    expect(rpc).toHaveBeenCalledWith('release_registration_reminder_email_in_flight', {
      p_user_id: 'u1',
      p_reminder_stage: 1,
      p_error: 'verification_application_exists',
    })
  })

  it('J. Resend failure releases in-flight for retry', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ message: 'fail' }), { status: 500 })),
    )
    const { admin, rpc, emailConfirmedAt } = buildDeliverMocks({ sentStages: [] })
    const r = await deliverRegistrationReminderEmailIfNeeded(admin, 'u1', {
      stage: 1,
      emailConfirmedAt,
      eligibleAfterMs,
      hasAnyVerificationApplication: false,
      hasLegacyVerificationDocsOnly: false,
      lifecycleGender: 'unknown',
    })
    expect(r).toBe('failed')
    expect(rpc).toHaveBeenCalledWith('release_registration_reminder_email_in_flight', {
      p_user_id: 'u1',
      p_reminder_stage: 1,
      p_error: expect.any(String),
    })
  })

  it('D. runGuard blocks second send same user same run', async () => {
    const { admin, emailConfirmedAt } = buildDeliverMocks({ sentStages: [] })
    const runGuard: RegistrationReminderRunGuard = { sentUserIdsThisRun: new Set(['u1']) }
    const r = await deliverRegistrationReminderEmailIfNeeded(admin, 'u1', {
      stage: 1,
      emailConfirmedAt,
      eligibleAfterMs,
      hasAnyVerificationApplication: false,
      hasLegacyVerificationDocsOnly: false,
      lifecycleGender: 'unknown',
      runGuard,
    })
    expect(r).toBe('skipped')
  })

  it('80h user only stage1 when none sent (pickEarliest via deliver stage2 request)', async () => {
    const { admin, rpc, emailConfirmedAt } = buildDeliverMocks({ sentStages: [] })
    await deliverRegistrationReminderEmailIfNeeded(admin, 'u1', {
      stage: 2,
      emailConfirmedAt,
      eligibleAfterMs,
      hasAnyVerificationApplication: false,
      hasLegacyVerificationDocsOnly: false,
      lifecycleGender: 'unknown',
    })
    expect(rpc).toHaveBeenCalledWith('release_registration_reminder_email_in_flight', {
      p_user_id: 'u1',
      p_reminder_stage: 2,
      p_error: 'predecessor_stage_not_sent',
    })
  })
})

describe('retryPendingRegistrationReminderEmails run guard', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ id: 'resend-1' }), { status: 200 })),
    )
    process.env.RESEND_API_KEY = 're_test'
    process.env.APPROVAL_EMAIL_FROM = 'tsmedia <noreply@tsmedia.tw>'
  })

  it('D. retry skips user already sent this run', async () => {
    const uid = '11111111-1111-1111-1111-111111111111'
    const confirmed = confirmedAtHoursAgo(80)
    const { admin, rpc } = buildDeliverMocks({ sentStages: [] })

    const from = admin.from as ReturnType<typeof vi.fn>
    from.mockImplementation((table: string) => {
      if (table === 'registration_reminder_email_deliveries') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          not: vi.fn().mockReturnThis(),
          is: vi.fn().mockReturnThis(),
          limit: vi.fn(async () => ({ data: [{ user_id: uid }], error: null })),
          gte: vi.fn().mockReturnThis(),
        }
      }
      if (table === 'verification_applications' || table === 'verification_docs') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          limit: vi.fn(async () => ({ data: [], error: null })),
          range: vi.fn(async () => ({ data: [], error: null })),
        }
      }
      return {
        select: vi.fn().mockReturnThis(),
        range: vi.fn(async () => ({ data: [], error: null })),
      }
    })

    ;(admin.auth.admin.getUserById as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: { user: { email: 'u@example.com', email_confirmed_at: confirmed } },
      error: null,
    })

    const runGuard: RegistrationReminderRunGuard = { sentUserIdsThisRun: new Set([uid]) }
    const result = await retryPendingRegistrationReminderEmails(admin, {
      limit: 5,
      eligibleAfterMs,
      runGuard,
      submittedUserIds: new Set(),
      legacyUserIds: new Set(),
    })

    expect(result.sentByStage[1] + result.sentByStage[2] + result.sentByStage[3]).toBe(0)
    expect(rpc).not.toHaveBeenCalledWith('claim_registration_reminder_email_delivery', expect.anything())
  })
})
