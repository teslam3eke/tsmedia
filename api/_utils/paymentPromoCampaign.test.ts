import { describe, expect, it } from 'vitest'
import {
  GeneralPromoDiscountError,
  generalPromoPriceFromListNtd,
  paymentPromoCampaignMayStillApply,
  satisfiesHistoricalPromoDiscountCheck,
  shouldBumpLowDiscountCampaignToFive,
  validateGeneralPromoDiscountTenths,
} from './paymentPromoCampaign'

const now = new Date('2026-06-01T12:00:00+08:00').getTime()

describe('general payment promo campaign floor (5折 minimum)', () => {
  it('allows 5折 campaign', () => {
    expect(() => validateGeneralPromoDiscountTenths(5)).not.toThrow()
    expect(generalPromoPriceFromListNtd(599, 5)).toBe(299)
  })

  it('rejects 4折 campaign (admin RPC mirror)', () => {
    expect(() => validateGeneralPromoDiscountTenths(4)).toThrow(GeneralPromoDiscountError)
  })

  it('rejects 2折 campaign', () => {
    expect(() => validateGeneralPromoDiscountTenths(2)).toThrow(GeneralPromoDiscountError)
  })

  it('clamps legacy 2折 when resolving live price', () => {
    expect(generalPromoPriceFromListNtd(599, 2)).toBe(299)
  })
})

describe('migration 162 promo row policy', () => {
  it('keeps ended 2折 historical campaign at 2', () => {
    const row = {
      discount_tenths: 2,
      cancelled_at: null,
      ends_at: '2025-01-01T00:00:00+08:00',
    }
    expect(shouldBumpLowDiscountCampaignToFive(row, now)).toBe(false)
    expect(satisfiesHistoricalPromoDiscountCheck(row, now)).toBe(true)
  })

  it('keeps cancelled 2折 historical campaign at 2', () => {
    const row = {
      discount_tenths: 2,
      cancelled_at: '2025-06-01T00:00:00+08:00',
      ends_at: '2027-01-01T00:00:00+08:00',
    }
    expect(shouldBumpLowDiscountCampaignToFive(row, now)).toBe(false)
    expect(satisfiesHistoricalPromoDiscountCheck(row, now)).toBe(true)
  })

  it('bumps active 2折 campaign to 5', () => {
    const row = {
      discount_tenths: 2,
      cancelled_at: null,
      ends_at: '2027-01-01T00:00:00+08:00',
    }
    expect(paymentPromoCampaignMayStillApply(row, now)).toBe(true)
    expect(shouldBumpLowDiscountCampaignToFive(row, now)).toBe(true)
    expect(satisfiesHistoricalPromoDiscountCheck(row, now)).toBe(false)
  })

  it('bumps future scheduled 2折 campaign to 5', () => {
    const row = {
      discount_tenths: 2,
      cancelled_at: null,
      ends_at: '2027-12-31T23:59:59+08:00',
    }
    expect(shouldBumpLowDiscountCampaignToFive(row, now)).toBe(true)
  })
})
