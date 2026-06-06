import { supabase } from './supabase'
import { clearAppQueryCache } from './queryClient'
import { unsubscribeWebPushOnSignOut } from './webPush'
import { isIosNonSafariBrowser } from './authBrowser'
import { iosOrIpadosLikely } from './resumeHardReload'
import type { EmailOtpType, User, Session } from '@supabase/supabase-js'

export type AuthResult =
  | { ok: true; user: User; session: Session | null }
  | { ok: false; error: string }

// ── 註冊（Email + Password）────────────────────────────────────
function siteOriginBase(): string | undefined {
  if (typeof window === 'undefined') return undefined
  const fromEnv = import.meta.env.VITE_SITE_URL?.trim().replace(/\/$/, '')
  if (fromEnv) return fromEnv
  return window.location.origin
}

function emailRedirectUrl(): string | undefined {
  const base = siteOriginBase()
  if (!base) return undefined
  return `${base}/`
}

/** 重設密碼信 redirect；帶 `auth=recovery` 供 PKCE 回站辨識（跨裝置亦可靠）。 */
function passwordResetRedirectUrl(): string | undefined {
  const base = siteOriginBase()
  if (!base) return undefined
  return `${base}/?auth=recovery`
}

function urlIndicatesPasswordRecovery(url: URL): boolean {
  if (url.searchParams.get('auth') === 'recovery') return true
  if (url.searchParams.get('type') === 'recovery') return true
  if (url.hash.includes('type=recovery')) return true
  return readPasswordResetFlowStarted() || readPasswordRecoveryPending()
}

function markRecoveryFromAuthCallback(url: URL): boolean {
  const recovery = urlIndicatesPasswordRecovery(url)
  if (recovery) {
    markPasswordRecoveryPending()
    clearPasswordResetFlowStarted()
  }
  return recovery
}

export async function signUp(email: string, password: string): Promise<AuthResult> {
  const redirectTo = emailRedirectUrl()
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: redirectTo ? { emailRedirectTo: redirectTo } : undefined,
  })
  if (error || !data.user) {
    return { ok: false, error: mapError(error?.message) }
  }
  return { ok: true, user: data.user, session: data.session }
}

// ── 登入 ──────────────────────────────────────────────────────
export async function signIn(email: string, password: string): Promise<AuthResult> {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  if (error || !data.user) {
    return { ok: false, error: mapError(error?.message) }
  }
  return { ok: true, user: data.user, session: data.session }
}

// ── 忘記密碼（寄送 Email 重設連結）────────────────────────────
export async function requestPasswordReset(
  email: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const redirectTo = passwordResetRedirectUrl()
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: redirectTo ?? undefined,
  })
  if (error) return { ok: false, error: mapError(error.message) }
  markPasswordResetFlowStarted()
  return { ok: true }
}

/** 同裝置申請重設密碼後的備援旗標（跨裝置主要靠 redirect `?auth=recovery`） */
export const PASSWORD_RESET_FLOW_KEY = 'tm_password_reset_flow_v1'

const PASSWORD_RESET_FLOW_TTL_MS = 24 * 60 * 60 * 1000

export function markPasswordResetFlowStarted(): void {
  try {
    sessionStorage.setItem(PASSWORD_RESET_FLOW_KEY, String(Date.now()))
  } catch {
    /* private mode */
  }
}

export function readPasswordResetFlowStarted(): boolean {
  try {
    const raw = sessionStorage.getItem(PASSWORD_RESET_FLOW_KEY)
    if (!raw) return false
    const ts = Number(raw)
    if (!Number.isFinite(ts) || Date.now() - ts > PASSWORD_RESET_FLOW_TTL_MS) {
      clearPasswordResetFlowStarted()
      return false
    }
    return true
  } catch {
    return false
  }
}

export function clearPasswordResetFlowStarted(): void {
  try {
    sessionStorage.removeItem(PASSWORD_RESET_FLOW_KEY)
  } catch {
    /* private mode */
  }
}

/** 使用者點重設密碼信後須先完成 {@link updatePassword}，再進 onboarding／主畫面 */
export const PASSWORD_RECOVERY_PENDING_KEY = 'tm_password_recovery_v1'

export function markPasswordRecoveryPending(): void {
  try {
    sessionStorage.setItem(PASSWORD_RECOVERY_PENDING_KEY, '1')
  } catch {
    /* private mode */
  }
}

export function readPasswordRecoveryPending(): boolean {
  try {
    return sessionStorage.getItem(PASSWORD_RECOVERY_PENDING_KEY) === '1'
  } catch {
    return false
  }
}

export function clearPasswordRecoveryPending(): void {
  try {
    sessionStorage.removeItem(PASSWORD_RECOVERY_PENDING_KEY)
  } catch {
    /* private mode */
  }
}

export async function updatePassword(
  newPassword: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await supabase.auth.updateUser({ password: newPassword })
  if (error) return { ok: false, error: mapError(error.message) }
  clearPasswordRecoveryPending()
  return { ok: true }
}

/** iOS 非 Safari 開啟 PKCE 確認連結時暫存完整 URL（尚未換券，避免 code 被消耗） */
export const IOS_AUTH_CALLBACK_URL_KEY = 'tm_ios_auth_callback_url'

export type AuthCallbackConsumeResult =
  | { outcome: 'none' }
  | { outcome: 'session'; passwordRecovery?: boolean }
  | { outcome: 'failed' }
  | { outcome: 'deferred_ios_non_safari' }

export function readIosDeferredAuthCallbackUrl(): string | null {
  if (typeof window === 'undefined') return null
  try {
    return sessionStorage.getItem(IOS_AUTH_CALLBACK_URL_KEY)
  } catch {
    return null
  }
}

export function clearIosDeferredAuthCallbackUrl(): void {
  try {
    sessionStorage.removeItem(IOS_AUTH_CALLBACK_URL_KEY)
  } catch {
    /* ignore */
  }
}

export function shouldShowIosSafariAuthGuide(): boolean {
  if (typeof window === 'undefined') return false
  if (readIosDeferredAuthCallbackUrl()) return true
  const url = new URL(window.location.href)
  return Boolean(url.searchParams.get('code') && isIosNonSafariBrowser())
}

const AUTH_CALLBACK_QUERY_PARAMS = [
  'code',
  'token_hash',
  'type',
  'auth',
  'access_token',
  'refresh_token',
  'expires_in',
  'expires_at',
  'token_type',
  'error',
  'error_description',
  'error_code',
] as const

/** 信箱確認／重設密碼回站時 URL 是否帶 Supabase auth callback 參數 */
export function urlHasSupabaseAuthCallback(): boolean {
  if (typeof window === 'undefined') return false
  const url = new URL(window.location.href)
  if (url.searchParams.get('code')) return true
  if (url.searchParams.get('token_hash')) return true
  if (url.hash.includes('access_token=')) return true
  return false
}

/** 換券完成後清掉 ?code= 等，避免重新整理重複消費或卡在 landing */
export function stripSupabaseAuthCallbackFromUrl(): void {
  if (typeof window === 'undefined') return
  const url = new URL(window.location.href)
  let changed = false
  for (const key of AUTH_CALLBACK_QUERY_PARAMS) {
    if (url.searchParams.has(key)) {
      url.searchParams.delete(key)
      changed = true
    }
  }
  if (url.hash && (url.hash.includes('access_token=') || url.hash.includes('error='))) {
    url.hash = ''
    changed = true
  }
  if (!changed) return
  const qs = url.searchParams.toString()
  window.history.replaceState({}, '', url.pathname + (qs ? `?${qs}` : '') + url.hash)
}

/**
 * Email 確認／重設密碼（PKCE `?code=`）：須在首屏路由前 await，避免 getSession 仍 null 而誤進 landing。
 * iOS 非 Safari 不換券，改引導使用者用 Safari 開同一連結。
 */
export async function consumeSupabaseAuthCallbackFromUrl(): Promise<AuthCallbackConsumeResult> {
  if (typeof window === 'undefined') return { outcome: 'none' }

  const url = new URL(window.location.href)
  const code = url.searchParams.get('code')

  if (code) {
    if (isIosNonSafariBrowser()) {
      try {
        sessionStorage.setItem(IOS_AUTH_CALLBACK_URL_KEY, window.location.href)
      } catch {
        /* ignore */
      }
      return { outcome: 'deferred_ios_non_safari' }
    }

    const {
      data: { session: existing },
    } = await supabase.auth.getSession()
    if (existing) {
      const passwordRecovery = markRecoveryFromAuthCallback(url)
      stripSupabaseAuthCallbackFromUrl()
      clearIosDeferredAuthCallbackUrl()
      return {
        outcome: 'session',
        passwordRecovery,
      }
    }

    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (error) {
      console.warn('[auth] exchangeCodeForSession', error.message)
      stripSupabaseAuthCallbackFromUrl()
      if (iosOrIpadosLikely()) {
        try {
          sessionStorage.setItem(IOS_AUTH_CALLBACK_URL_KEY, url.href)
        } catch {
          /* ignore */
        }
      }
      return { outcome: 'failed' }
    }
    const passwordRecovery = markRecoveryFromAuthCallback(url)
    stripSupabaseAuthCallbackFromUrl()
    clearIosDeferredAuthCallbackUrl()
    return {
      outcome: 'session',
      passwordRecovery,
    }
  }

  const tokenHash = url.searchParams.get('token_hash')
  const type = url.searchParams.get('type')
  if (tokenHash && type) {
    const isRecovery = type === 'recovery'
    const { error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type: type as EmailOtpType,
    })
    stripSupabaseAuthCallbackFromUrl()
    if (error) {
      console.warn('[auth] verifyOtp', error.message)
      return { outcome: 'failed' }
    }
    if (isRecovery) markPasswordRecoveryPending()
    clearIosDeferredAuthCallbackUrl()
    return { outcome: 'session', passwordRecovery: isRecovery }
  }

  return { outcome: 'none' }
}

// ── 登出 ──────────────────────────────────────────────────────
export async function signOut(): Promise<void> {
  await unsubscribeWebPushOnSignOut()
  clearAppQueryCache()
  await supabase.auth.signOut()
}

// ── 取得目前登入用戶 ──────────────────────────────────────────
export async function getCurrentUser(): Promise<User | null> {
  const { data } = await supabase.auth.getUser()
  return data.user ?? null
}

// ── 監聽 Auth 狀態變化 ────────────────────────────────────────
export function onAuthStateChange(callback: (user: User | null) => void) {
  const { data } = supabase.auth.onAuthStateChange((_event, session) => {
    callback(session?.user ?? null)
  })
  return data.subscription
}

// ── 錯誤訊息中文化 ────────────────────────────────────────────
function mapError(msg?: string): string {
  if (!msg) return '發生未知錯誤，請稍後再試'
  if (msg.includes('Invalid login credentials')) return '信箱或密碼錯誤，請重新輸入'
  if (msg.includes('Email not confirmed')) return '請先確認信箱，再登入'
  if (msg.includes('User already registered')) return '此信箱已被註冊，請直接登入'
  if (msg.includes('Password should be')) return '密碼需至少 6 個字元'
  if (msg.includes('rate limit')) return '嘗試次數過多，請稍待片刻'
  if (msg.includes('network')) return '網路連線異常，請檢查網路後再試'
  return msg
}
