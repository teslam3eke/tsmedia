import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

const approveMock = vi.fn()
const rejectMock = vi.fn()

vi.mock('./verificationApplicationReview.js', () => ({
  runApproveVerificationApplication: (...args: unknown[]) => approveMock(...args),
  runRejectVerificationApplication: (...args: unknown[]) => rejectMock(...args),
}))

import { runVerificationAutoReviewAfterSubmit } from './verificationAutoReview.js'

type Row = Record<string, unknown>

function makeAdmin(state: {
  app: Row
  profile: Row
  autoRejectCount?: number
}) {
  const apps = { ...state.app }
  const profiles = { ...state.profile }

  const from = vi.fn((table: string) => {
    const api = {
      select: vi.fn(() => api),
      eq: vi.fn(() => api),
      is: vi.fn(() => api),
      like: vi.fn(() => api),
      maybeSingle: vi.fn(async () => {
        if (table === 'verification_applications') {
          return { data: apps, error: null }
        }
        if (table === 'profiles') {
          return { data: profiles, error: null }
        }
        return { data: null, error: null }
      }),
      single: vi.fn(async () => ({ data: apps, error: null })),
      update: vi.fn((patch: Row) => {
        const chain = {
          eq: vi.fn(() => chain),
          is: vi.fn(() => chain),
          select: vi.fn(() => ({
            maybeSingle: vi.fn(async () => {
              if (table === 'verification_applications') {
                Object.assign(apps, patch)
                if (patch.auto_review_claimed_at && !apps.id) apps.id = 'app-1'
                return { data: { id: apps.id ?? 'app-1' }, error: null }
              }
              return { data: null, error: null }
            }),
          })),
          then: undefined,
        }
        if (table === 'verification_applications') Object.assign(apps, patch)
        if (table === 'profiles') Object.assign(profiles, patch)
        return chain
      }),
      insert: vi.fn(() => api),
    }
    if (table === 'verification_applications' && state.autoRejectCount != null) {
      api.select = vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(() => ({
            like: vi.fn(async () => ({ count: state.autoRejectCount, error: null })),
          })),
        })),
      })) as typeof api.select
    }
    return api
  })

  return { from } as unknown as SupabaseClient
}

describe('runVerificationAutoReviewAfterSubmit', () => {
  beforeEach(() => {
    approveMock.mockReset()
    rejectMock.mockReset()
    approveMock.mockResolvedValue({ ok: true, pushSent: 1, pushFailed: 0 })
    rejectMock.mockResolvedValue({ ok: true, pushSent: 1, pushFailed: 0 })
  })

  it('auto approves normal profile via runApproveVerificationApplication (no income tier)', async () => {
    const admin = makeAdmin({
      app: { id: 'app-1', user_id: 'u1', status: 'pending', auto_review_outcome: null, auto_review_claimed_at: null },
      profile: {
        id: 'u1',
        verification_status: 'submitted',
        verification_text_auto_strikes: 0,
        name: 'Test',
        gender: 'male',
        company: 'ACME',
        bio: '',
        questionnaire: [{ id: 1, answer: '喜歡爬山跟攝影' }],
        photo_urls: ['photos/a.jpg'],
      },
    })

    const r = await runVerificationAutoReviewAfterSubmit(admin, 'app-1')
    expect(r.outcome).toBe('approved')
    expect(approveMock).toHaveBeenCalledWith(admin, 'app-1', { approveIncome: false })
  })

  it('first text fail rejects with preset note', async () => {
    const admin = makeAdmin({
      app: { id: 'app-1', user_id: 'u1', status: 'pending', auto_review_outcome: null, auto_review_claimed_at: null },
      profile: {
        id: 'u1',
        verification_status: 'submitted',
        verification_text_auto_strikes: 0,
        name: 'Test',
        gender: 'female',
        company: 'ACME',
        bio: '',
        questionnaire: [{ id: 1, answer: '不知道' }],
        photo_urls: ['p.jpg'],
      },
    })

    const r = await runVerificationAutoReviewAfterSubmit(admin, 'app-1')
    expect(r.outcome).toBe('text_rejected')
    expect(rejectMock).toHaveBeenCalled()
    expect(approveMock).not.toHaveBeenCalled()
  })

  it('second text fail escalates to manual_queue (no third auto reject)', async () => {
    const admin = makeAdmin({
      app: { id: 'app-2', user_id: 'u1', status: 'pending', auto_review_outcome: null, auto_review_claimed_at: null },
      profile: {
        id: 'u1',
        verification_status: 'submitted',
        verification_text_auto_strikes: 1,
        name: 'Test',
        gender: 'male',
        company: 'ACME',
        bio: '',
        questionnaire: [{ id: 1, answer: '!!!!!' }],
        photo_urls: ['p.jpg'],
      },
    })

    const r = await runVerificationAutoReviewAfterSubmit(admin, 'app-2')
    expect(r.outcome).toBe('manual_queue')
    expect(rejectMock).not.toHaveBeenCalled()
    expect(approveMock).not.toHaveBeenCalled()
  })

  it('already approved profile skips auto review', async () => {
    const admin = makeAdmin({
      app: { id: 'app-3', user_id: 'u1', status: 'pending', auto_review_outcome: null, auto_review_claimed_at: null },
      profile: {
        id: 'u1',
        verification_status: 'approved',
        name: 'Test',
        gender: 'male',
        company: 'ACME',
        bio: '',
        questionnaire: [],
        photo_urls: ['p.jpg'],
      },
    })

    const r = await runVerificationAutoReviewAfterSubmit(admin, 'app-3')
    expect(r.outcome).toBe('already_approved')
    expect(approveMock).not.toHaveBeenCalled()
  })

  it('second submit with clean text after one strike auto approves', async () => {
    const admin = makeAdmin({
      app: { id: 'app-5', user_id: 'u1', status: 'pending', auto_review_outcome: null, auto_review_claimed_at: null },
      profile: {
        id: 'u1',
        verification_status: 'submitted',
        verification_text_auto_strikes: 0,
        name: 'Test',
        gender: 'male',
        company: 'ACME',
        bio: '',
        questionnaire: [{ id: 1, answer: '喜歡爬山跟攝影' }],
        photo_urls: ['p.jpg'],
      },
    })

    const r = await runVerificationAutoReviewAfterSubmit(admin, 'app-5')
    expect(r.outcome).toBe('approved')
    expect(approveMock).toHaveBeenCalledWith(admin, 'app-5', { approveIncome: false })
  })

  it('approve failure escalates to manual_required (fail safe)', async () => {
    approveMock.mockResolvedValueOnce({ ok: false, error: 'db' })
    const admin = makeAdmin({
      app: { id: 'app-4', user_id: 'u1', status: 'pending', auto_review_outcome: null, auto_review_claimed_at: null },
      profile: {
        id: 'u1',
        verification_status: 'submitted',
        verification_text_auto_strikes: 0,
        name: 'Test',
        gender: 'male',
        company: 'ACME',
        bio: '',
        questionnaire: [{ id: 1, answer: '週末愛看電影' }],
        photo_urls: ['p.jpg'],
      },
    })

    const r = await runVerificationAutoReviewAfterSubmit(admin, 'app-4')
    expect(r.outcome).toBe('manual_required')
    expect(approveMock).toHaveBeenCalled()
  })
})
