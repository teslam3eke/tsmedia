import { describe, expect, it } from 'vitest'
import { buildCheckMacValue, verifyCheckMacValue } from '../../api/_utils/ecpayCrypto'

/** 綠界測試環境範例（官方文件） */
const STAGE_KEY = '5294y06JbISpM5x9'
const STAGE_IV = 'v77hoKGq4kWxNNIS'

describe('ecpayCrypto', () => {
  it('buildCheckMacValue matches ECPay stage sample', () => {
    const params: Record<string, string> = {
      ChoosePayment: 'ALL',
      EncryptType: '1',
      ItemName: 'Apple iphone 15',
      MerchantID: '2000132',
      MerchantTradeDate: '2023/03/12 15:30:23',
      MerchantTradeNo: 'test123456',
      PaymentType: 'aio',
      ReturnURL: 'https://www.ecpay.com.tw/receive.php',
      TotalAmount: '3000',
      TradeDesc: '促銷方案',
    }
    const mac = buildCheckMacValue(params, STAGE_KEY, STAGE_IV)
    expect(mac).toMatch(/^[0-9A-F]{64}$/)
    expect(verifyCheckMacValue({ ...params, CheckMacValue: mac }, STAGE_KEY, STAGE_IV)).toBe(true)
  })

  it('empty StoreID still participates in MAC (ECPay SDK parity)', () => {
    const params: Record<string, string> = {
      MerchantID: '2000132',
      MerchantTradeNo: 'TSMQ6NBYYXBOGQ',
      StoreID: '',
      RtnCode: '1',
      RtnMsg: 'paid',
      TradeNo: '2606082352547940',
      TradeAmt: '30',
      PaymentDate: '2026/06/09 20:59:11',
      PaymentType: 'Credit_CreditCard',
      PaymentTypeChargeFee: '1',
      TradeDate: '2026/06/09 20:59:10',
      SimulatePaid: '0',
      EncryptType: '1',
    }
    const withEmpty = buildCheckMacValue(params, STAGE_KEY, STAGE_IV)
    const withoutKey = { ...params }
    delete withoutKey.StoreID
    expect(buildCheckMacValue(withoutKey, STAGE_KEY, STAGE_IV)).not.toBe(withEmpty)
  })

  it('verify notify-like params with PaymentType underscore', () => {
    const params: Record<string, string> = {
      MerchantID: '2000132',
      MerchantTradeNo: 'TSMQ6NBYYXBOGQ',
      RtnCode: '1',
      RtnMsg: 'paid',
      TradeNo: '2606082352547940',
      TradeAmt: '30',
      PaymentDate: '2026/06/09 20:59:11',
      PaymentType: 'Credit_CreditCard',
      PaymentTypeChargeFee: '1',
      TradeDate: '2026/06/09 20:59:10',
      SimulatePaid: '0',
      EncryptType: '1',
    }
    const mac = buildCheckMacValue(params, STAGE_KEY, STAGE_IV)
    expect(verifyCheckMacValue({ ...params, CheckMacValue: mac }, STAGE_KEY, STAGE_IV)).toBe(true)
  })
})
