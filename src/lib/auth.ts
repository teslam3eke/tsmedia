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

/** 重設密碼信 redirect；專用路徑供 PKCE 回站辨識（跨裝置、新分頁皆可靠）。 */
function passwordResetRedirectUrl(): string | undefined {
  const base = siteOriginBase()
  if (!base) return undefined
  return `${base}/reset-password`
}

function pathnameIsPasswordRecovery(pathname: string): boolean {
  const path = pathname.replace(/\/$/, '') || '/'
  return path === '/reset-password' || path.endsWith('/reset-password')
}

/** 目前網址是否在重設密碼專用路徑（信內 redirect_to 落地後） */
export function isOnPasswordRecoveryRoute(): boolean {
  if (typeof window === 'undefined') return false
  return pathnameIsPasswordRecovery(window.location.pathname)
}

function urlIndicatesPasswordRecovery(url: URL): boolean {
  if (pathnameIsPasswordRecovery(url.pathname)) return true
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
  const val = String(Date.now())
  try {
    sessionStorage.setItem(PASSWORD_RESET_FLOW_KEY, val)
  } catch {
    /* private mode */
  }
  try {
    localStorage.setItem(PASSWORD_RESET_FLOW_KEY, val)
  } catch {
    /* private mode */
  }
}

export function readPasswordResetFlowStarted(): boolean {
  let raw: string | null = null
  try {
    raw = sessionStorage.getItem(PASSWORD_RESET_FLOW_KEY)
  } catch {
    /* ignore */
  }
  if (!raw) {
    try {
      raw = localStorage.getItem(PASSWORD_RESET_FLOW_KEY)
    } catch {
      /* ignore */
    }
  }
  if (!raw) return false
  const ts = Number(raw)
  if (!Number.isFinite(ts) || Date.now() - ts > PASSWORD_RESET_FLOW_TTL_MS) {
    clearPasswordResetFlowStarted()
    return false
  }
  return true
}

export function clearPasswordResetFlowStarted(): void {
  try {
    sessionStorage.removeItem(PASSWORD_RESET_FLOW_KEY)
  } catch {
    /* private mode */
  }
  try {
    localStorage.removeItem(PASSWORD_RESET_FLOW_KEY)
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

/** 重設完成後把 /reset-password 清回根路徑，避免重新整理又進重設頁 */
export function normalizeUrlAfterPasswordRecovery(): void {
  if (typeof window === 'undefined') return
  if (!pathnameIsPasswordRecovery(window.location.pathname)) return
  window.history.replaceState({}, '', '/')
}

export async function updatePassword(
  newPassword: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await supabase.auth.updateUser({ password: newPassword })
  if (error) return { ok: false, error: mapError(error.message) }
  clearPasswordRecoveryPending()
  normalizeUrlAfterPasswordRecovery()
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
 * Email 確認／重設密碼回站：await {@link supabase.auth.initialize} 換 session（implicit hash），
 * 再依路徑標記 recovery。iOS 非 Safari 不換券，改引導 Safari。
 */
export async function consumeSupabaseAuthCallbackFromUrl(): Promise<AuthCallbackConsumeResult> {
  if (typeof window === 'undefined') return { outcome: 'none' }

  const url = new URL(window.location.href)
  const hadCallback = urlHasSupabaseAuthCallback()
  const recoveryIntent = urlIndicatesPasswordRecovery(url)

  if (isIosNonSafariBrowser() && hadCallback) {
    try {
      sessionStorage.setItem(IOS_AUTH_CALLBACK_URL_KEY, window.location.href)
    } catch {
      /* ignore */
    }
    return { outcome: 'deferred_ios_non_safari' }
  }

  if (hadCallback) {
    const { error } = await supabase.auth.initialize()
    if (error) {
      console.warn('[auth] initialize from callback URL', error.message)
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
  }

  const tokenHash = url.searchParams.get('token_hash')
  const type = url.searchParams.get('type')
  if (tokenHash && type && !hadCallback) {
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

  const {
    data: { session },
  } = await supabase.auth.getSession()

  if (session && (hadCallback || recoveryIntent)) {
    const passwordRecovery =
      recoveryIntent || readPasswordRecoveryPending()
        ? markRecoveryFromAuthCallback(url)
        : false
    stripSupabaseAuthCallbackFromUrl()
    clearIosDeferredAuthCallbackUrl()
    return { outcome: 'session', passwordRecovery }
  }

  if (hadCallback && !session) {
    stripSupabaseAuthCallbackFromUrl()
    return { outcome: 'failed' }
  }

  return { outcome: 'none' }
}

/** 重設密碼頁：若 boot 時未換到 session，再試一次 initialize／getUser */
export async function ensureRecoveryAuthSession(): Promise<User | null> {
  if (typeof window === 'undefined') return null
  if (readIosDeferredAuthCallbackUrl()) return null

  if (urlHasSupabaseAuthCallback()) {
    const consumed = await consumeSupabaseAuthCallbackFromUrl()
    if (consumed.outcome === 'session') {
      const { data: { user } } = await supabase.auth.getUser()
      return user ?? null
    }
  }

  await supabase.auth.initialize()
  const { data: { user } } = await supabase.auth.getUser()
  if (user) return user

  const { data: { session } } = await supabase.auth.getSession()
  if (session?.user) return session.user

  return null
}

/**
 * 從外部金流全頁跳轉回 PWA 時，WebKit 偶發首輪 `getSession()` 為 null（storage 尚未就緒）。
 * 付款返回等場景在導向 landing 前先多試換發／讀取，避免誤判登出。
 */
export async function restorePersistedAuthSession(budgetMs = 8_000): Promise<User | null> {
  if (typeof window === 'undefined') return null

  try {
    await supabase.auth.initialize()
  } catch {
    /* ignore */
  }

  const deadline = Date.now() + budgetMs
  while (Date.now() < deadline) {
    try {
      const { data: refreshed } = await supabase.auth.refreshSession()
      if (refreshed.session?.user) return refreshed.session.user
    } catch {
      /* ignore */
    }

    const {
      data: { session },
    } = await supabase.auth.getSession()
    if (session?.user) return session.user

    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (user) return user

    await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 280))
  }

  return null
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
