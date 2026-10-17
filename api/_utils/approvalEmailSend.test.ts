import { afterEach, describe, expect, it, vi } from 'vitest'
import { sendApprovalEmailToRecipient } from './approvalEmailSend'

describe('approvalEmailSend', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('skips when RESEND not configured', async () => {
    const r = await sendApprovalEmailToRecipient('user@example.com')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.skipped).toBe(true)
  })

  it('does not expose api key in frontend bundle path', () => {
    expect(typeof process.env.VITE_RESEND_API_KEY).toBe('undefined')
  })

  it('calls Resend when configured', async () => {
    vi.stubEnv('RESEND_API_KEY', 're_test_key')
    vi.stubEnv('APPROVAL_EMAIL_FROM', 'tsmedia <notify@tsmedia.tw>')

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ id: 'email_1' }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const r = await sendApprovalEmailToRecipient('member@example.com')
    expect(r.ok).toBe(true)
    expect(fetchMock).toHaveBeenCalledOnce()
    const init = fetchMock.mock.calls[0][1] as RequestInit
    const headers = init.headers as Record<string, string>
    expect(headers.Authorization).toContain('Bearer')
    const body = JSON.parse(String(init.body)) as { html?: string; text?: string; to?: string[] }
    expect(body.html).toBeTruthy()
    expect(body.text).toBeTruthy()
    expect(body.to?.[0]).toBe('member@example.com')
  })
})
