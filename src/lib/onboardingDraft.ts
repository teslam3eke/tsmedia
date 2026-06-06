import { useEffect, useState } from 'react'
import { ensureConnectionWithBudget, repairAuthAfterResume } from '@/lib/supabase'

const RESUME_PROTECT_KEY = 'tm_onboarding_resume_protect'

export const ONBOARDING_FLOW_SCREENS = [
  'security-check',
  'terms-consent',
  'profile-setup',
  'questionnaire',
  'identity-verify',
] as const

export type OnboardingFlowScreen = (typeof ONBOARDING_FLOW_SCREENS)[number]

export function isOnboardingFlowScreen(screen: string): screen is OnboardingFlowScreen {
  return (ONBOARDING_FLOW_SCREENS as readonly string[]).includes(screen)
}

/** 註冊／填資料流程中：禁止 ensureConnection 失敗時整頁 reload（會清掉未送出的表單與 blob）。 */
export function setOnboardingResumeProtect(on: boolean): void {
  try {
    if (on) sessionStorage.setItem(RESUME_PROTECT_KEY, '1')
    else sessionStorage.removeItem(RESUME_PROTECT_KEY)
  } catch {
    /* private mode */
  }
}

export function isOnboardingResumeProtectActive(): boolean {
  try {
    return sessionStorage.getItem(RESUME_PROTECT_KEY) === '1'
  } catch {
    return false
  }
}

function draftKey(userId: string | undefined, kind: string): string {
  return `tm_ob_draft_${kind}_${userId?.trim() || 'anon'}`
}

export function saveOnboardingJsonDraft<T>(userId: string | undefined, kind: string, value: T): void {
  try {
    sessionStorage.setItem(draftKey(userId, kind), JSON.stringify(value))
  } catch {
    /* quota / private mode */
  }
}

export function loadOnboardingJsonDraft<T>(userId: string | undefined, kind: string): T | null {
  try {
    const raw = sessionStorage.getItem(draftKey(userId, kind))
    if (!raw) return null
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

export function clearOnboardingJsonDraft(userId: string | undefined, kind: string): void {
  try {
    sessionStorage.removeItem(draftKey(userId, kind))
  } catch {
    /* ignore */
  }
}

const MIN_FOREGROUND_MS = 450

/**
 * 探索頁同款：回前景換發 JWT + bounded ensure，但不整頁 reload。
 * 回傳 nonce 供子元件在必要時重試唯讀 API（不覆寫 session 草稿）。
 */
export function useOnboardingForegroundRepair(enabled: boolean): number {
  const [nonce, setNonce] = useState(0)

  useEffect(() => {
    if (!enabled || typeof document === 'undefined') return

    let hiddenAt: number | null = null

    const onWake = () => {
      if (document.visibilityState !== 'visible') return
      if (hiddenAt == null) return
      const elapsed = Date.now() - hiddenAt
      hiddenAt = null
      if (elapsed < MIN_FOREGROUND_MS) return
      void repairAuthAfterResume().then(() => ensureConnectionWithBudget())
      setNonce((n) => n + 1)
    }

    const onHide = () => {
      hiddenAt = Date.now()
    }

    const onVisibility = () => {
      if (document.visibilityState === 'hidden') onHide()
      else onWake()
    }

    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pageshow', onWake)

    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pageshow', onWake)
    }
  }, [enabled])

  return nonce
}
