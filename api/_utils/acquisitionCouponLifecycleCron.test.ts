import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  isIssueRpcPaidOrIneligibleError,
  parseIssueAcquisitionCouponRpc,
} from './acquisitionCouponLifecycleCron'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const vercelJson = JSON.parse(
  fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'),
) as { crons?: { path: string; schedule: string }[] }

describe('acquisition lifecycle cron wiring', () => {
  it('registers 6-hour cron path', () => {
    const entry = vercelJson.crons?.find(
      (c) => c.path === '/api/cron-acquisition-coupon-lifecycle',
    )
    expect(entry?.schedule).toBe('0 */6 * * *')
  })
})

describe('parseIssueAcquisitionCouponRpc', () => {
  it('parses issued entitlement', () => {
    const r = parseIssueAcquisitionCouponRpc({
      ok: true,
      entitlement_id: 'e1',
      already_existed: false,
    })
    expect(r).toEqual({ kind: 'issued', entitlementId: 'e1', alreadyExisted: false })
  })

  it('marks already existed', () => {
    const r = parseIssueAcquisitionCouponRpc({
      ok: true,
      entitlement_id: 'e1',
      already_existed: true,
    })
    expect(r).toEqual({ kind: 'issued', entitlementId: 'e1', alreadyExisted: true })
  })
})

describe('isIssueRpcPaidOrIneligibleError', () => {
  it('classifies paid and too early', () => {
    expect(isIssueRpcPaidOrIneligibleError('COUPON_NOT_FIRST_MEMBERSHIP_PURCHASE')).toBe('paid')
    expect(isIssueRpcPaidOrIneligibleError('COUPON_LIFECYCLE_TOO_EARLY')).toBe('too_early')
    expect(isIssueRpcPaidOrIneligibleError('OTHER')).toBe('other')
  })
})
