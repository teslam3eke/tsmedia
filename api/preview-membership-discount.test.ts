import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const readAuthedUserIdMock = vi.fn()
const previewAuthoritativeMock = vi.fn()
const createClientMock = vi.fn()

vi.mock('@supabase/supabase-js', () => ({
  createClient: (...args: unknown[]) => createClientMock(...args),
}))

vi.mock('./_utils/tappayPayByPrime.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./_utils/tappayPayByPrime.js')>()
  return {
    ...actual,
    readAuthedUserId: (...args: unknown[]) => readAuthedUserIdMock(...args),
  }
})

vi.mock('./_utils/previewMembershipDiscountServer.js', () => ({
  previewMembershipDiscountAuthoritative: (...args: unknown[]) => previewAuthoritativeMock(...args),
}))

function mockRes(): VercelResponse & { statusCode: number; body: unknown } {
  const state = { statusCode: 200, body: null as unknown }
  return {
    get statusCode() {
      return state.statusCode
    },
    get body() {
      return state.body
    },
    setHeader: vi.fn(),
    status(code: number) {
      state.statusCode = code
      return this as VercelResponse
    },
    json(payload: unknown) {
      state.body = payload
      return this as VercelResponse
    },
  } as VercelResponse & { statusCode: number; body: unknown }
}

function mockReq(partial: Partial<VercelRequest>): VercelRequest {
  return {
    method: 'POST',
    headers: {},
    body: { code: 'TSSPE' },
    ...partial,
  } as VercelRequest
}

describe('preview-membership-discount API route', () => {
  beforeEach(() => {
    vi.resetModules()
    readAuthedUserIdMock.mockReset()
    previewAuthoritativeMock.mockReset()
    createClientMock.mockReset()
    createClientMock.mockImplementation(() => ({
      from: vi.fn(() => ({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({
              data: {
                gender: 'male',
                verification_status: 'approved',
                account_status: 'active',
              },
              error: null,
            }),
          }),
        }),
      })),
    }))
    process.env.SUPABASE_URL = 'https://example.supabase.co'
    process.env.SUPABASE_ANON_KEY = 'anon-key'
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key'
  })

  it('1. module loads without readTapPayEnv', async () => {
    const src = fs.readFileSync(path.join(root, 'api/preview-membership-discount.ts'), 'utf8')
    expect(src).not.toMatch(/readTapPayEnv/)
    await expect(import('./preview-membership-discount.js')).resolves.toBeDefined()
  })

  it('2. POST without Authorization → 401 before Supabase env', async () => {
    delete process.env.SUPABASE_URL
    delete process.env.SUPABASE_ANON_KEY
    delete process.env.SUPABASE_SERVICE_ROLE_KEY

    const { default: handler } = await import('./preview-membership-discount.js')
    const res = mockRes()
    await handler(mockReq({ headers: {} }), res)

    expect(res.statusCode).toBe(401)
    expect(readAuthedUserIdMock).not.toHaveBeenCalled()
    expect(previewAuthoritativeMock).not.toHaveBeenCalled()
  })

  it('3. malformed Bearer → 401', async () => {
    const { default: handler } = await import('./preview-membership-discount.js')
    const res = mockRes()
    await handler(mockReq({ headers: { authorization: 'Bearer ' } }), res)
    expect(res.statusCode).toBe(401)
    expect(readAuthedUserIdMock).not.toHaveBeenCalled()

    const res2 = mockRes()
    readAuthedUserIdMock.mockResolvedValue({
      ok: false,
      status: 401,
      error: '登入已過期，請重新登入。',
    })
    await handler(mockReq({ headers: { authorization: 'Bearer not-a-real-jwt' } }), res2)
    expect(res2.statusCode).toBe(401)
    expect(previewAuthoritativeMock).not.toHaveBeenCalled()
  })

  it('4–5. authenticated path delegates to authoritative preview (TSSPE success / invalid)', async () => {
    readAuthedUserIdMock.mockResolvedValue({ ok: true, userId: 'user-1' })
    previewAuthoritativeMock.mockResolvedValueOnce({ ok: true, valid: true, discount_ntd: 150 })
    previewAuthoritativeMock.mockResolvedValueOnce({ ok: true, valid: false, reason: 'tsspe_not_eligible' })

    const { default: handler } = await import('./preview-membership-discount.js')

    const resOk = mockRes()
    await handler(
      mockReq({ headers: { authorization: 'Bearer valid-token' }, body: { code: 'TSSPE' } }),
      resOk,
    )
    expect(resOk.statusCode).toBe(200)
    expect(previewAuthoritativeMock).toHaveBeenCalled()

    const resInvalid = mockRes()
    await handler(
      mockReq({ headers: { authorization: 'Bearer valid-token' }, body: { code: 'TSSPE' } }),
      resInvalid,
    )
    expect(resInvalid.statusCode).toBe(200)
    expect(previewAuthoritativeMock).toHaveBeenCalledTimes(2)
  })

  it('8. preview route does not import TapPay payment config', () => {
    const src = fs.readFileSync(path.join(root, 'api/preview-membership-discount.ts'), 'utf8')
    expect(src).not.toMatch(/readTapPayServerConfig/)
    expect(src).not.toMatch(/TAPPAY_/)
    expect(src).toMatch(/previewMembershipDiscountAuthoritative/)
  })

  it('9–10. ECPay / TapPay TSSPE checkout entrypoints unchanged in this hotfix', () => {
    const ecpay = fs.readFileSync(path.join(root, 'api/ecpay-create-order.ts'), 'utf8')
    const tappay = fs.readFileSync(path.join(root, 'api/tappay-membership.ts'), 'utf8')
    expect(ecpay).toMatch(/TSSPE_NOT_CONFIGURED/)
    expect(tappay).toMatch(/TSSPE_NOT_CONFIGURED/)
    expect(ecpay).toMatch(/resolveMaleMembershipCheckout/)
    expect(tappay).toMatch(/resolveMaleMembershipCheckout/)
  })
})

describe('preview-membership-discount — TSVIP / TSFB via server module', () => {
  it('6–7. TSVIP / TSFB preview paths remain in previewMembershipDiscountServer tests', () => {
    const testSrc = fs.readFileSync(
      path.join(root, 'api/_utils/previewMembershipDiscountServer.test.ts'),
      'utf8',
    )
    expect(testSrc).toMatch(/TSVIP|tsvip/i)
    expect(testSrc).toMatch(/TSFB|tsfb/i)
  })
})
