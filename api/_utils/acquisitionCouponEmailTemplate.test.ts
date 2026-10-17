import { describe, expect, it } from 'vitest'
import { USER_COUPON_CAMPAIGN } from './membershipCheckoutPricing'
import {
  ACQUISITION_EMAIL_48H_SUBJECT,
  ACQUISITION_EMAIL_7D_SUBJECT,
  EMAIL_LAUNCH_ACQUISITION_COUPON_VALUE,
  EMAIL_LAUNCH_FROM_PARAM,
  buildAcquisitionCouponEmailCtaUrl,
  buildAcquisitionCouponEmailContent,
} from './acquisitionCouponEmailTemplate'

describe('acquisition coupon email template', () => {
  it('CTA contains fromEmail=acquisition_coupon without PII', () => {
    const url = buildAcquisitionCouponEmailCtaUrl('https://tsmedia.tw')
    expect(url).toBe(
      `https://tsmedia.tw/?${EMAIL_LAUNCH_FROM_PARAM}=${EMAIL_LAUNCH_ACQUISITION_COUPON_VALUE}`,
    )
    expect(url).not.toMatch(/user_id|entitlement|uuid|@/i)
  })

  it('48h email uses approved copy and CTA label', () => {
    const c = buildAcquisitionCouponEmailContent(
      USER_COUPON_CAMPAIGN.APPROVED_48H_200,
      'https://tsmedia.tw',
    )
    expect(c.subject).toBe(ACQUISITION_EMAIL_48H_SUBJECT)
    expect(c.html).toContain('使用 $200 優惠')
    expect(c.text).toContain('折價已自動帶入')
    expect(c.html).toContain(c.ctaUrl)
  })

  it('7d email uses 3折 copy', () => {
    const c = buildAcquisitionCouponEmailContent(
      USER_COUPON_CAMPAIGN.APPROVED_7D_30PCT,
      'https://tsmedia.tw',
    )
    expect(c.subject).toBe(ACQUISITION_EMAIL_7D_SUBJECT)
    expect(c.html).toContain('使用 3 折優惠')
    expect(c.text).toContain('最後一次為你保留的會員優惠')
  })
})
