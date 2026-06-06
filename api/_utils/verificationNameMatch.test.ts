import { describe, expect, it } from 'vitest'
import { claimedNameMatchesDetected } from './verificationNameMatch'

describe('claimedNameMatchesDetected', () => {
  it('員工證：中文申報姓名可對上中英並列 OCR', () => {
    expect(
      claimedNameMatchesDetected('陳怡君', '陳怡君／CHEN YI-CHUN', { docType: 'employee_id' }),
    ).toBe(true)
  })

  it('扣繳憑單：只認中文，英文 alone 不通過', () => {
    expect(
      claimedNameMatchesDetected('陳怡君', 'CHEN YI-CHUN', { docType: 'tax_return' }),
    ).toBe(false)
  })

  it('扣繳憑單：中文姓名可對上', () => {
    expect(
      claimedNameMatchesDetected('陳怡君', '陳怡君', { docType: 'tax_return' }),
    ).toBe(true)
    expect(
      claimedNameMatchesDetected('陳怡君', '所得人姓名：陳怡君\nEN: CHEN YI-CHUN', { docType: 'tax_return' }),
    ).toBe(true)
  })

  it('薪資單：同扣繳只比中文', () => {
    expect(
      claimedNameMatchesDetected('王小明', 'WANG HSIAO-MING', { docType: 'payslip' }),
    ).toBe(false)
    expect(
      claimedNameMatchesDetected('王小明', '王小明', { docType: 'payslip' }),
    ).toBe(true)
  })
})
