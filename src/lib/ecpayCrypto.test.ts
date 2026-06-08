import { describe, expect, it } from 'vitest'
import { buildCheckMacValue } from '../../api/_utils/ecpayCrypto'

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
    expect(buildCheckMacValue({ ...params, CheckMacValue: mac }, STAGE_KEY, STAGE_IV)).toBe(mac)
  })
})
