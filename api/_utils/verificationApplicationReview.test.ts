import { describe, expect, it } from 'vitest'
import { buildApprovalEmailCtaUrl } from './approvalEmailTemplate.js'

/**
 * 審核／Email 整合測試以 claim RPC + server handler 為準；
 * 此處鎖定「僅 approved 路徑會帶 Email CTA」等靜態契約。
 */
describe('verification approval email contract', () => {
  it('approval CTA has no PII params', () => {
    const url = new URL(buildApprovalEmailCtaUrl('https://tsmedia.tw'))
    expect(url.searchParams.get('fromEmail')).toBe('approval')
    expect([...url.searchParams.keys()]).toEqual(['fromEmail'])
    expect(url.searchParams.get('fromEmail')).toBe('approval')
  })

})
