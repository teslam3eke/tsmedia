import { supabase } from './supabase'
import type { User, Session } from '@supabase/supabase-js'

export type AuthResult =
  | { ok: true; user: User; session: Session | null }
  | { ok: false; error: string }

// ── 註冊（Email + Password）────────────────────────────────────
export async function signUp(email: string, password: string): Promise<AuthResult> {
  const { data, error } = await supabase.auth.signUp({ email, password })
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

// ── 登出 ──────────────────────────────────────────────────────
export async function signOut(): Promise<void> {
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
