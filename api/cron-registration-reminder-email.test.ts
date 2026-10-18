import { beforeEach, describe, expect, it, vi } from 'vitest'

describe('cron-registration-reminder-email auth', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.unstubAllEnvs()
  })

  it('P. CRON_SECRET missing → 500, cron not executed', async () => {
    vi.stubEnv('CRON_SECRET', '')
    vi.stubEnv('SUPABASE_URL', 'https://example.supabase.co')
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-key')

    const runCron = vi.fn()
    vi.doMock('./_utils/registrationReminderCron.js', () => ({
      runRegistrationReminderEmailCron: runCron,
    }))

    const { default: handler } = await import('./cron-registration-reminder-email.js')
    const res = {
      statusCode: 0,
      body: null as unknown,
      status(code: number) {
        this.statusCode = code
        return this
      },
      json(payload: unknown) {
        this.body = payload
        return this
      },
      end() {
        return this
      },
    }

    await handler({ method: 'GET', headers: {} } as never, res as never)
    expect(res.statusCode).toBe(500)
    expect(runCron).not.toHaveBeenCalled()
  })

  it('Q. wrong Bearer → 401', async () => {
    vi.stubEnv('CRON_SECRET', 'secret-123')
    vi.stubEnv('SUPABASE_URL', 'https://example.supabase.co')
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-key')

    const runCron = vi.fn()
    vi.doMock('./_utils/registrationReminderCron.js', () => ({
      runRegistrationReminderEmailCron: runCron,
    }))

    const { default: handler } = await import('./cron-registration-reminder-email.js')
    const res = {
      statusCode: 0,
      body: null as unknown,
      status(code: number) {
        this.statusCode = code
        return this
      },
      json(payload: unknown) {
        this.body = payload
        return this
      },
      end() {
        return this
      },
    }

    await handler(
      { method: 'GET', headers: { authorization: 'Bearer wrong' } } as never,
      res as never,
    )
    expect(res.statusCode).toBe(401)
    expect(runCron).not.toHaveBeenCalled()
  })
})
