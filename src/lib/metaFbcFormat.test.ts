import { describe, expect, it } from 'vitest'
import {
  buildFbcValue,
  creationTimeSecFromFbcValue,
  fbclidFromFbcValue,
} from './metaFbcFormat'

describe('meta fbc format', () => {
  it('preserves creationTime when parsing fbc', () => {
    const fbc = buildFbcValue('AbCd123', 1_700_000_000)
    expect(fbclidFromFbcValue(fbc)).toBe('AbCd123')
    expect(creationTimeSecFromFbcValue(fbc)).toBe(1_700_000_000)
  })

  it('does not change creationTime when same fbclid would reuse cookie value', () => {
    const first = buildFbcValue('x', 100)
    const second = buildFbcValue('x', 999)
    expect(fbclidFromFbcValue(first)).toBe(fbclidFromFbcValue(second))
    expect(creationTimeSecFromFbcValue(first)).toBe(100)
    expect(creationTimeSecFromFbcValue(second)).toBe(999)
  })
})
