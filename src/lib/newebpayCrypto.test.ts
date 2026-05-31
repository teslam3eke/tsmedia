import { describe, expect, it } from 'vitest'
import {
  buildMpgTradeQuery,
  buildTradeSha,
  decryptTradeInfo,
  encryptTradeInfo,
  parseTradeInfoPlain,
  verifyTradeSha,
} from '../../api/_utils/newebpayCrypto'

/** 藍新文件範例用測試 HashKey／HashIV（僅供加解密自測） */
const TEST_KEY = '12345678901234567890123456789012'
const TEST_IV = '1234567890123456'

describe('newebpayCrypto', () => {
  it('encrypt → decrypt roundtrip', () => {
    const plain = buildMpgTradeQuery({
      MerchantID: 'MS123',
      RespondType: 'JSON',
      TimeStamp: 1700000000,
      Version: '2.0',
      MerchantOrderNo: 'TMTEST001',
      Amt: 399,
      ItemDesc: 'tsMedia VIP',
    })
    const tradeInfo = encryptTradeInfo(plain, TEST_KEY, TEST_IV)
    const tradeSha = buildTradeSha(tradeInfo, TEST_KEY, TEST_IV)
    expect(verifyTradeSha(tradeInfo, tradeSha, TEST_KEY, TEST_IV)).toBe(true)
    const decrypted = decryptTradeInfo(tradeInfo, TEST_KEY, TEST_IV)
    expect(decrypted).toBe(plain)
    const parsed = parseTradeInfoPlain(decrypted)
    expect(parsed.MerchantOrderNo).toBe('TMTEST001')
    expect(parsed.Amt).toBe('399')
  })
})
