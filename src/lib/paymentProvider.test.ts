import { describe, expect, it } from 'vitest'
import { resolvePaymentProviderMode } from './paymentProvider'

describe('resolvePaymentProviderMode', () => {
  it('prefers ecpay when configured', () => {
    expect(
      resolvePaymentProviderMode({
        ecpayConfigured: true,
        tapPayConfigured: true,
        allowClientMockPayment: true,
      }),
    ).toBe('ecpay')
  })

  it('uses tappay when ecpay off and tap configured', () => {
    expect(
      resolvePaymentProviderMode({
        ecpayConfigured: false,
        tapPayConfigured: true,
        allowClientMockPayment: false,
      }),
    ).toBe('tappay')
  })

  it('uses mock only when explicitly allowed and no real provider', () => {
    expect(
      resolvePaymentProviderMode({
        ecpayConfigured: false,
        tapPayConfigured: false,
        allowClientMockPayment: true,
      }),
    ).toBe('mock')
  })

  it('L. production-like: no provider and mock disallowed → unavailable', () => {
    expect(
      resolvePaymentProviderMode({
        ecpayConfigured: false,
        tapPayConfigured: false,
        allowClientMockPayment: false,
      }),
    ).toBe('unavailable')
  })
})
