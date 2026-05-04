import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn('[TsMedia] Supabase env vars not set — running in offline mode.')
}

export const supabase = createClient(supabaseUrl ?? '', supabaseAnonKey ?? '', {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    flowType: 'pkce',
  },
})

let wakeMutex: Promise<void> | null = null

/**
 * iOS Safari／PWA：進背景時計時器暫停，`autoRefreshToken` 可能沒換發 JWT；
 * 回前景後請求會帶過期 token → `getProfile`／RPC 空資料或失敗。
 * 於 visibility / pageshow 呼叫一次（可 debounce），必要時 `refreshSession`。
 */
export function wakeSupabaseAuthFromBackground(): Promise<void> {
  if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
    return Promise.resolve()
  }

  if (!wakeMutex) {
    wakeMutex = (async () => {
      try {
        const { data: { session }, error: sessErr } = await supabase.auth.getSession()
        if (sessErr || !session) return

        const expMs = session.expires_at ? session.expires_at * 1000 : 0
        const needsRefresh = !expMs || expMs < Date.now() + 120_000
        if (needsRefresh) {
          await supabase.auth.refreshSession()
        }
      } catch {
        /* 離線或競態：略過 */
      }
    })().finally(() => {
      wakeMutex = null
    })
  }
  return wakeMutex
}
