import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { REGISTRATION_REMINDER_166_SERVICE_ROLE_ONLY_RPCS } from './couponServiceRpcAccess.test'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const migration166 = fs.readFileSync(
  path.join(root, 'supabase/migrations/166_registration_reminder_email.sql'),
  'utf8',
)

describe('migration 166 registration reminder', () => {
  it('defines rollout cutoff, deliveries, and service_role RPCs', () => {
    expect(migration166).toMatch(/registration_reminder_rollout/)
    expect(migration166).toMatch(/insert into public\.registration_reminder_rollout/)
    expect(migration166).toMatch(/registration_reminder_email_deliveries/)
    expect(migration166).toMatch(/registration_reminder_email_deliveries_user_stage_uidx/)
    expect(migration166).toMatch(/reminder_stage smallint not null check \(reminder_stage between 1 and 3\)/)
    expect(migration166).toMatch(/claim_registration_reminder_email_delivery/)
    expect(migration166).toMatch(/p_reminder_stage smallint/)
    expect(migration166).toMatch(/interval '90 seconds'/)
    expect(migration166).toMatch(
      /revoke all on function public\.claim_registration_reminder_email_delivery\(uuid, smallint\)/u,
    )
    expect(migration166).not.toMatch(/verification_applications.*add column/i)
  })

  it('documents 166 RPC list for service-only', () => {
    expect(REGISTRATION_REMINDER_166_SERVICE_ROLE_ONLY_RPCS).toContain(
      'mark_registration_reminder_email_sent',
    )
  })
})
