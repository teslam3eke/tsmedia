import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  EMAIL_LAUNCH_ACQUISITION_COUPON_VALUE,
  EMAIL_LAUNCH_APPROVAL_VALUE,
  EMAIL_LAUNCH_FROM_PARAM,
  EMAIL_LAUNCH_VERIFICATION_REMINDER_VALUE,
  captureEmailLaunchSourceFromUrl,
  isEmailCtaPathInPwaScope,
  readEmailLaunchSource,
} from './emailLaunchSource'

describe('emailLaunchSource', () => {
  const store = new Map<string, string>()

  beforeEach(() => {
    store.clear()
    vi.stubGlobal('sessionStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => store.set(k, v),
      removeItem: (k: string) => store.delete(k),
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('captures fromEmail=approval before strip', () => {
    const href = `https://tsmedia.tw/?${EMAIL_LAUNCH_FROM_PARAM}=${EMAIL_LAUNCH_APPROVAL_VALUE}`
    vi.stubGlobal('window', {
      location: { href, search: `?${EMAIL_LAUNCH_FROM_PARAM}=${EMAIL_LAUNCH_APPROVAL_VALUE}`, pathname: '/', hash: '' },
      history: { replaceState: vi.fn() },
    } as unknown as Window)

    captureEmailLaunchSourceFromUrl()
    const src = readEmailLaunchSource()
    expect(src?.kind).toBe(EMAIL_LAUNCH_APPROVAL_VALUE)
  })

  it('captures fromEmail=verification_reminder', () => {
    const href = `https://tsmedia.tw/?${EMAIL_LAUNCH_FROM_PARAM}=${EMAIL_LAUNCH_VERIFICATION_REMINDER_VALUE}`
    vi.stubGlobal('window', {
      location: {
        href,
        search: `?${EMAIL_LAUNCH_FROM_PARAM}=${EMAIL_LAUNCH_VERIFICATION_REMINDER_VALUE}`,
        pathname: '/',
        hash: '',
      },
      history: { replaceState: vi.fn() },
    } as unknown as Window)

    captureEmailLaunchSourceFromUrl()
    const src = readEmailLaunchSource()
    expect(src?.kind).toBe(EMAIL_LAUNCH_VERIFICATION_REMINDER_VALUE)
  })

  it('captures fromEmail=acquisition_coupon', () => {
    const href = `https://tsmedia.tw/?${EMAIL_LAUNCH_FROM_PARAM}=${EMAIL_LAUNCH_ACQUISITION_COUPON_VALUE}`
    vi.stubGlobal('window', {
      location: {
        href,
        search: `?${EMAIL_LAUNCH_FROM_PARAM}=${EMAIL_LAUNCH_ACQUISITION_COUPON_VALUE}`,
        pathname: '/',
        hash: '',
      },
      history: { replaceState: vi.fn() },
    } as unknown as Window)

    captureEmailLaunchSourceFromUrl()
    const src = readEmailLaunchSource()
    expect(src?.kind).toBe(EMAIL_LAUNCH_ACQUISITION_COUPON_VALUE)
  })

  it('CTA path is in PWA scope', () => {
    expect(isEmailCtaPathInPwaScope('/')).toBe(true)
    expect(isEmailCtaPathInPwaScope('/join')).toBe(true)
  })
})
