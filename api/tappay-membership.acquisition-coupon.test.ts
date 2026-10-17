import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * TapPay 路徑不支援 acquisition coupon（行為由 handler 內 early return 保證）。
 * 此測試鎖定 policy，避免日後誤刪拒絕邏輯。
 */
describe('tappay-membership acquisition coupon policy', () => {
  it('rejects userCouponEntitlementId in handler source', () => {
    const file = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      'tappay-membership.ts',
    )
    const src = readFileSync(file, 'utf8')
    expect(src).toMatch(/userCouponEntitlementId/)
    expect(src).toMatch(/此優惠券僅支援綠界付款流程/)
  })
})
